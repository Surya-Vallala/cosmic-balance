// Checks send-push against reference Web Push implementations and a local
// database (Postgres on :5433 with schema.sql, PostgREST behind the test
// gateway on :54321). Run from this folder:
//   npm i --no-save http_ece@1.2.0 web-push@3.6.7
//   node --experimental-strip-types test.mts
import assert from 'node:assert/strict';
import { createECDH, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { createRequire } from 'node:module';
import {
  b64url,
  deliver,
  encrypt,
  fromB64url,
  handle,
  makeKeys,
  target,
  vapidHeader,
} from './index.ts';

const require = createRequire(import.meta.url);
const ece = require('http_ece');

let passed = 0;
const ok = (cond: unknown, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log('  ok:', msg);
};

// A phone's subscription, made the way browsers make it.
function phone() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return { ecdh, auth, sub: { p256dh: b64url(ecdh.getPublicKey()), auth: b64url(auth) } };
}
function open(body: Uint8Array, p: ReturnType<typeof phone>): string {
  return ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: p.ecdh, authSecret: p.auth }).toString();
}

// --- Encryption ------------------------------------------------------------------------
const p1 = phone();
const msg = JSON.stringify({ title: 'Cosmic Balance', body: 'Ravi added an expense in Goa', url: '?s=Group&groupId=x' });
const body = await encrypt(new TextEncoder().encode(msg), p1.sub);
ok(open(body, p1) === msg, 'a phone can read the message with the reference decryptor (RFC 8291 aes128gcm)');
const p2 = phone();
assert.throws(() => open(body, p2));
ok(true, 'another phone cannot read it');
ok(body.length < 4096 && body[20] === 65, 'the header carries the sender key, and the record fits in one block');
const long = 'x'.repeat(3000);
ok(open(await encrypt(new TextEncoder().encode(long), p1.sub), p1) === long, 'long messages still decrypt');

// Compare byte for byte with the reference encryptor, given the same salt and sender key.
const salt = randomBytes(16);
const senderNode = createECDH('prime256v1');
senderNode.generateKeys();
const priv = senderNode.getPrivateKey();
const pub = senderNode.getPublicKey();
const jwk = {
  kty: 'EC',
  crv: 'P-256',
  d: b64url(priv),
  x: b64url(pub.subarray(1, 33)),
  y: b64url(pub.subarray(33, 65)),
  ext: true,
};
const serverKeys = {
  privateKey: await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']),
  publicKey: await crypto.subtle.importKey('raw', pub, { name: 'ECDH', namedCurve: 'P-256' }, true, []),
};
const mine = await encrypt(new TextEncoder().encode(msg), p1.sub, { salt, serverKeys });
const ref = ece.encrypt(Buffer.from(msg), {
  version: 'aes128gcm',
  salt,
  privateKey: senderNode,
  dh: p1.ecdh.getPublicKey(),
  authSecret: p1.auth,
  keyid: pub,
  rs: 4096,
});
ok(Buffer.from(mine).equals(ref), 'identical bytes to the reference encryptor');

// --- VAPID -----------------------------------------------------------------------------
const keys = await makeKeys();
ok(fromB64url(keys.public_key).length === 65 && fromB64url(keys.public_key)[0] === 4, 'the public key is an uncompressed P-256 point');
const h = await vapidHeader('https://fcm.googleapis.com/fcm/send/abc', keys);
const [, jwt, k] = h.match(/^vapid t=([^,]+), k=(.+)$/)!;
ok(k === keys.public_key, 'the header names our public key');
const [hd, cl, sig] = jwt.split('.');
const claims = JSON.parse(new TextDecoder().decode(fromB64url(cl)));
ok(claims.aud === 'https://fcm.googleapis.com' && claims.sub.startsWith('https://') && claims.exp > Date.now() / 1000 + 3600 &&
     claims.exp <= Date.now() / 1000 + 24 * 3600, 'claims: audience is the push service, subject is ours, expiry within a day');
const verifyKey = await crypto.subtle.importKey('raw', fromB64url(keys.public_key), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifyKey, fromB64url(sig), new TextEncoder().encode(`${hd}.${cl}`)),
   'the signature verifies with our public key (ES256)');
// Cross-check with the web-push library's own header for the same keys.
const webpush = require('web-push');
const ref2 = webpush.getVapidHeaders('https://fcm.googleapis.com', 'https://example.com/', keys.public_key,
  b64url(fromB64url((keys.private_key as { d: string }).d)), 'aes128gcm');
ok(ref2.Authorization.startsWith('vapid t=') && ref2.Authorization.endsWith(`k=${keys.public_key}`),
   'web-push accepts our key pair and builds the same kind of header');
ok(target({ group_id: 'g1', person_id: null, kind: 'expense' }) === '?s=Group&groupId=g1' &&
   target({ group_id: null, person_id: 'p1', kind: 'joined' }) === '?s=Friend&friendId=p1', 'tapping opens the right screen');

// --- Against the local database ------------------------------------------------------------
const SECRET = 'local-test-secret-that-is-at-least-32-characters-long';
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const head = b64({ alg: 'HS256', typ: 'JWT' });
const claimsSR = b64({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 3600 });
const serviceJwt = `${head}.${claimsSR}.${createHmac('sha256', SECRET).update(`${head}.${claimsSR}`).digest('base64url')}`;
const psql = (sql: string) =>
  execFileSync('psql', ['-h', '/tmp', '-p', '5433', '-U', 'postgres', '-d', 'ck', '-Atc', sql]).toString().trim();

psql('delete from public.notifications; delete from public.push_subscriptions; delete from public.push_keys;');
const user = randomUUID();
psql(`insert into auth.users (id, email) values ('${user}', 'pushy-${user}@gmail.com')`);

// A pretend push service: records what it gets.
const received: { headers: http.IncomingHttpHeaders; body: Buffer; path: string }[] = [];
const server = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    received.push({ headers: req.headers, body: Buffer.concat(chunks), path: req.url! });
    res.writeHead(req.url === '/gone' ? 410 : 201).end();
  });
});
await new Promise<void>((r) => server.listen(8799, r));
const ph = phone();
psql(`insert into public.push_subscriptions (endpoint, user_id, p256dh, auth) values
  ('http://localhost:8799/live', '${user}', '${ph.sub.p256dh}', '${ph.sub.auth}'),
  ('http://localhost:8799/gone', '${user}', '${phone().sub.p256dh}', '${phone().sub.auth}')`);
const gid = randomUUID();
psql(`insert into public.notifications (user_id, kind, body, group_id) values ('${user}', 'expense', 'Ravi added an expense in Goa', null),
       ('${user}', 'request', 'Priya asked to join Goa', null)`);

const env = new Map([
  ['SUPABASE_URL', 'http://localhost:54321'],
  ['SUPABASE_SECRET_KEYS', JSON.stringify({ default: serviceJwt })],
]);
const result = await deliver({ get: (n) => env.get(n) });
ok(psql('select count(*) from public.push_keys') === '1', 'the first run makes and stores a key pair');
ok(result.sent === 2 && result.gone === 2, `both notifications reach the live phone, the gone phone is counted (${JSON.stringify(result)})`);
ok(psql("select count(*) from public.push_subscriptions where endpoint like '%/gone'") === '0', 'a phone that is gone is dropped');
ok(psql('select count(*) from public.notifications where pushed_at is null') === '0', 'everything is marked sent');
const live = received.filter((r) => r.path === '/live');
const bodies = live.map((r) => JSON.parse(open(new Uint8Array(r.body), ph)).body).sort();
ok(JSON.stringify(bodies) === JSON.stringify(['Priya asked to join Goa', 'Ravi added an expense in Goa']), 'the phone decrypts each message');
const first = JSON.parse(open(new Uint8Array(live[0].body), ph));
ok(first.title === 'Cosmic Balance' && first.unread === 2 && first.url === '?s=Notifications', 'with a title, the unread count and where to go');
const pubKey = psql('select public_key from public.push_keys');
ok(live.every((r) => r.headers['content-encoding'] === 'aes128gcm' && String(r.headers.authorization).endsWith(`k=${pubKey}`) &&
   r.headers.ttl === '86400'), 'requests carry the encryption, signature and lifetime headers push services need');
const again = await deliver({ get: (n) => env.get(n) });
ok(again.sent === 0 && psql('select public_key from public.push_keys') === pubKey, 'a second run sends nothing new and keeps the same keys');

// The HTTP handler, as Supabase calls it.
const res = await handle(new Request('http://x/send-push', { method: 'POST', body: '{}' }), { get: (n) => env.get(n) });
ok(res.status === 200 && JSON.stringify(await res.json()) === '{"ok":true}', 'the function answers a plain POST, saying no more than ok');
const pre = await handle(new Request('http://x/send-push', { method: 'OPTIONS' }), { get: (n) => env.get(n) });
ok(pre.headers.get('access-control-allow-origin') === '*', 'and lets the app call it from the browser');
// A key the gateway refuses is skipped for the next one (new secret keys first, then the older kind).
const SIGNED = (role: string) => {
  const c = b64({ role, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${head}.${c}.${createHmac('sha256', 'wrong-secret').update(`${head}.${c}`).digest('base64url')}`;
};
const mixed = new Map([
  ['SUPABASE_URL', 'http://localhost:54321'],
  ['SUPABASE_SECRET_KEYS', JSON.stringify({ default: SIGNED('service_role') })],
  ['SUPABASE_SERVICE_ROLE_KEY', serviceJwt],
]);
psql(`insert into public.notifications (user_id, kind, body) values ('${user}', 'expense', 'Fallback works')`);
const fb = await deliver({ get: (n) => mixed.get(n) });
ok(fb.sent === 1, 'if one project key is refused, the function uses the other');
const bad = await handle(new Request('http://x', { method: 'POST' }), { get: () => undefined });
ok(bad.status === 500 && JSON.stringify(await bad.json()) === '{"ok":false}', 'without the project keys it reports an error (with no details) instead of crashing');

server.close();
console.log(`\nAll ${passed} push checks passed.`);
