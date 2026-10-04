// Cosmic Balance: send-push
//
// Delivers new notifications to people's phones (Web Push). The database asks
// for this after each change (and the app does too); every call sends
// whatever hasn't been sent yet, so calling it more often than needed is
// harmless.
//
// Deploy it once in Supabase: Edge Functions → Deploy a new function → Via
// Editor, name it `send-push`, paste this whole file, deploy, then turn off
// "Verify JWT" for it (see the README). It needs no settings or secrets: it
// uses the project's own keys, which Supabase gives every function, and makes
// its push key pair the first time it runs (kept in the database).
//
// No libraries: Web Push encryption (RFC 8291) and signing (RFC 8292) use the
// standard Web Crypto API, so this file runs as it is.

const APP_URL = 'https://surya-vallala.github.io/cosmic-balance/';

// ---------------------------------------------------------------------------
// Bytes and base64url

type Bytes = Uint8Array<ArrayBuffer>;

export function b64url(bytes: Uint8Array | ArrayBuffer): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): Bytes {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const text = (s: string): Bytes => new Uint8Array(new TextEncoder().encode(s));

// ---------------------------------------------------------------------------
// Keys

export interface PushKeys {
  /** Uncompressed P-256 public key, base64url (what browsers call applicationServerKey). */
  public_key: string;
  /** The private key as a JWK. */
  private_key: JsonWebKey;
}

export async function makeKeys(): Promise<PushKeys> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const pub = await crypto.subtle.exportKey('raw', pair.publicKey);
  const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { public_key: b64url(pub), private_key: priv };
}

// ---------------------------------------------------------------------------
// VAPID (RFC 8292): proves to the push service that the message is from us.

export async function vapidHeader(endpoint: string, keys: PushKeys, subject = APP_URL): Promise<string> {
  const header = b64url(text(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(
    text(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: subject,
      }),
    ),
  );
  const key = await crypto.subtle.importKey('jwk', keys.private_key, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
  ]);
  // Web Crypto gives the raw r||s signature JWTs use.
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, text(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64url(sig)}, k=${keys.public_key}`;
}

// ---------------------------------------------------------------------------
// Encryption (RFC 8291, aes128gcm): only the phone can read the message.

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

export async function encrypt(
  payload: Uint8Array,
  sub: { p256dh: string; auth: string },
  opts: { salt?: Uint8Array; serverKeys?: CryptoKeyPair } = {},
): Promise<Bytes> {
  const uaPublic = fromB64url(sub.p256dh);
  const authSecret = fromB64url(sub.auth);
  const salt: Bytes = opts.salt ? new Uint8Array(opts.salt) : crypto.getRandomValues(new Uint8Array(16));
  const server =
    opts.serverKeys ??
    ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', server.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as EcdhKeyDeriveParams, server.privateKey, 256),
  );

  const ikm = await hkdf(authSecret, shared, concat(text('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, text('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, text('Content-Encoding: nonce\0'), 12);

  // One record: the message, then the 0x02 delimiter that marks the last record.
  const plain = concat(payload, new Uint8Array([2]));
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, plain));

  const rs = 4096;
  const header = concat(
    salt,
    new Uint8Array([(rs >>> 24) & 0xff, (rs >>> 16) & 0xff, (rs >>> 8) & 0xff, rs & 0xff]),
    new Uint8Array([asPublic.length]),
    asPublic,
  );
  return concat(header, cipher);
}

// ---------------------------------------------------------------------------
// The database (with the project's secret key, which Supabase gives functions)

interface Subscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}
interface Notice {
  id: string;
  kind: string;
  body: string;
  group_id: string | null;
  person_id: string | null;
  unread: number;
  subscriptions: Subscription[];
}

type Env = { get(name: string): string | undefined };

/** The project's secret keys, newest kind first (both kinds are given to every function). */
function secretKeys(env: Env): string[] {
  const keys: string[] = [];
  const all = env.get('SUPABASE_SECRET_KEYS');
  if (all) {
    try {
      const parsed = JSON.parse(all) as Record<string, string>;
      if (parsed.default) keys.push(parsed.default);
      for (const k of Object.values(parsed)) if (k && !keys.includes(k)) keys.push(k);
    } catch {
      // not JSON: ignore and use the older key
    }
  }
  const legacy = env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) keys.push(legacy);
  return keys;
}

function db(env: Env) {
  const url = env.get('SUPABASE_URL') ?? '';
  const keys = secretKeys(env);
  let working: string | null = null;
  const call = (key: string, fn: string, args: Record<string, unknown>) => {
    const headers: Record<string, string> = { apikey: key, 'Content-Type': 'application/json' };
    if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`; // older JWT-style key
    return fetch(`${url}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
  };
  return async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    if (keys.length === 0) throw new Error('No project key available to this function.');
    let res: Response | null = null;
    for (const key of working ? [working] : keys) {
      res = await call(key, fn, args);
      if (res.status !== 401 && res.status !== 403) {
        working = key;
        break;
      }
      await res.body?.cancel();
    }
    if (!res || !res.ok) throw new Error(`${fn} failed: ${res?.status} ${res ? await res.text() : ''}`);
    const body = await res.text();
    return (body ? JSON.parse(body) : null) as T;
  };
}

/** Where tapping the notification takes you, relative to the app. */
export function target(n: Pick<Notice, 'group_id' | 'person_id' | 'kind'>): string {
  if (n.group_id) return `?s=Group&groupId=${encodeURIComponent(n.group_id)}`;
  if (n.person_id) return `?s=Friend&friendId=${encodeURIComponent(n.person_id)}`;
  return '?s=Notifications';
}

export async function sendOne(sub: Subscription, payload: object, keys: PushKeys): Promise<number> {
  const body = await encrypt(text(JSON.stringify(payload)), sub);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(sub.endpoint, keys),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(24 * 3600),
      Urgency: 'normal',
    },
    body,
    signal: AbortSignal.timeout(10000),
  });
  await res.body?.cancel();
  return res.status;
}

export async function deliver(env: Env): Promise<{ sent: number; gone: number; failed: number }> {
  const rpc = db(env);
  let keys = await rpc<PushKeys | null>('push_keys_get');
  if (!keys) {
    // First run: make the key pair. If two runs race, the first one stored wins.
    const made = await makeKeys();
    keys = await rpc<PushKeys>('push_keys_init', { p_public: made.public_key, p_private: made.private_key });
  }
  const counts = { sent: 0, gone: 0, failed: 0 };
  for (let round = 0; round < 10; round++) {
    const batch = (await rpc<Notice[]>('claim_push_batch', { p_limit: 200 })) ?? [];
    if (batch.length === 0) break;
    const jobs = batch.flatMap((n) => n.subscriptions.map((s) => ({ n, s })));
    // A few at a time, so a long list can't swamp the function.
    for (let i = 0; i < jobs.length; i += 10) {
      await Promise.all(
        jobs.slice(i, i + 10).map(async ({ n, s }) => {
          try {
            const status = await sendOne(
              s,
              { title: 'Cosmic Balance', body: n.body, tag: n.id, url: target(n), unread: n.unread },
              keys!,
            );
            if (status === 404 || status === 410) {
              counts.gone++;
              await rpc('drop_push_subscription', { p_endpoint: s.endpoint });
            } else if (status >= 200 && status < 300) counts.sent++;
            else counts.failed++;
          } catch {
            counts.failed++;
          }
        }),
      );
    }
  }
  return counts;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export async function handle(req: Request, env: Env): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  try {
    const result = await deliver(env);
    console.log('send-push', result); // in the function's logs, not the reply
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ ok: false }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
}

// In Supabase (Deno): serve requests.
const deno = (globalThis as { Deno?: { env: Env; serve: (h: (r: Request) => Promise<Response>) => void } }).Deno;
if (deno?.serve) deno.serve((req) => handle(req, deno.env));
