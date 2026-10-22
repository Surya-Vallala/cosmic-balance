// What's new since your last visit (shared mode).
//
// When you leave the app it remembers a short fingerprint of every expense,
// payment, transfer and group you can see. Next time you open it, anything a
// friend added or changed since then is marked, until you leave and come back
// again. Your own changes are never marked.
//
// Nothing here is sent anywhere: it's kept on the phone.
import { expensePeople } from './logic';
import type { AppState, Expense, Id, Payment, Transfer } from './types';

/**
 * Fingerprints by key: 'e:<id>' expenses, 'p:<id>' payments, 't:<id>'
 * transfers, 'g:<id>' groups, 'u:<id>' people.
 */
export type Seen = Record<string, string>;

/** FNV-1a: a short, stable hash. Only used to spot changes. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const byKey = <T>(o: Record<string, T> | undefined): [string, T][] =>
  Object.entries(o ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
const values = (o: Record<string, number> | undefined): number[] => Object.values(o ?? {}).sort((a, b) => a - b);
const text = (s: string | undefined) => (s ?? '').trim();

// Items in the app's state never change in place (a change makes a new
// object), so each one's fingerprint is worked out once.
const cache = new WeakMap<object, string>();

/**
 * Two hashes per item: everything that matters ("full"), and the same without
 * who it involves ("shape"). When a friend's placeholder is merged into their
 * account, only the ids change: the shape shows it's the same item.
 */
function print(item: object, full: () => unknown[], shape: () => unknown[]): string {
  let p = cache.get(item);
  if (p === undefined) {
    p = `${hash(JSON.stringify(full()))}.${hash(JSON.stringify(shape()))}`;
    cache.set(item, p);
  }
  return p;
}

const expensePrint = (e: Expense) =>
  print(
    e,
    () => [e.groupId ?? null, e.description, e.currency, e.amount, byKey(e.payers), byKey(e.shares), text(e.note), e.date],
    () => [e.groupId ?? null, e.description, e.currency, e.amount, values(e.payers), values(e.shares), text(e.note), e.date],
  );
const paymentPrint = (p: Payment) =>
  print(
    p,
    () => [p.groupId, p.from, p.to, p.currency, p.amount, p.date],
    () => [p.groupId, p.currency, p.amount, p.date],
  );
const transferPrint = (t: Transfer) =>
  print(
    t,
    () => [t.kind, t.from, t.to, t.currency, t.amount, text(t.note), t.date],
    () => [t.kind, t.currency, t.amount, text(t.note), t.date],
  );

/** A fingerprint of everything that can be marked new. */
export function fingerprints(s: AppState): Seen {
  const out: Seen = {};
  for (const id of Object.keys(s.people)) out[`u:${id}`] = '1';
  for (const g of s.groups) out[`g:${g.id}`] = '1';
  for (const e of s.expenses) out[`e:${e.id}`] = expensePrint(e);
  for (const p of s.payments) out[`p:${p.id}`] = paymentPrint(p);
  for (const t of s.transfers) out[`t:${t.id}`] = transferPrint(t);
  return out;
}

export interface Fresh {
  /** Items to mark: 'e:<id>', 'p:<id>', 't:<id>'. */
  items: Set<string>;
  /** Of those, the ones added since (not just changed). */
  added: Set<string>;
  /** Groups you were added to since. Everything in them is new, so only the group is marked. */
  newGroups: Set<Id>;
  /** Groups to mark on Home, with how many new things are in each (0 for a new group). */
  groups: Map<Id, number>;
  /** Friends to mark on Home, with how many new things are between you outside groups. */
  friends: Map<Id, number>;
  /** New things among the expenses outside groups. */
  outside: number;
}

export const NOTHING_NEW: Fresh = {
  items: new Set(),
  added: new Set(),
  newGroups: new Set(),
  groups: new Map(),
  friends: new Map(),
  outside: 0,
};

/** What's new or changed in `s` compared with what was seen. */
export function whatsNew(s: AppState, seen: Seen | null): Fresh {
  const me = s.meId;
  if (!seen || !me) return NOTHING_NEW;
  // Someone you could see before is gone: their placeholder may have been merged
  // into their account, which rewrites the ids on everything they're in.
  const merged = Object.keys(seen).some((k) => k.startsWith('u:') && !s.people[k.slice(2)]);
  const items = new Set<string>();
  const added = new Set<string>();
  const changed = (key: string, now: string): boolean => {
    const was = seen[key];
    if (was === now) return false;
    if (was === undefined) added.add(key);
    else if (merged && was.split('.')[1] === now.split('.')[1]) return false; // only the ids changed
    items.add(key);
    return true;
  };
  const newGroups = new Set(s.groups.filter((g) => seen[`g:${g.id}`] === undefined).map((g) => g.id));
  const groups = new Map<Id, number>([...newGroups].map((id) => [id, 0]));
  const friends = new Map<Id, number>();
  const bump = (m: Map<Id, number>, id: Id) => m.set(id, (m.get(id) ?? 0) + 1);
  let outside = 0;

  for (const e of s.expenses) {
    if (e.groupId && newGroups.has(e.groupId)) continue;
    if (!changed(`e:${e.id}`, expensePrint(e))) continue;
    if (e.groupId) bump(groups, e.groupId);
    else {
      outside += 1;
      const ids = expensePeople(e);
      if (ids.includes(me)) for (const id of ids) if (id !== me) bump(friends, id);
    }
  }
  for (const p of s.payments) {
    if (newGroups.has(p.groupId)) continue;
    if (changed(`p:${p.id}`, paymentPrint(p))) bump(groups, p.groupId);
  }
  for (const t of s.transfers) {
    if (!changed(`t:${t.id}`, transferPrint(t))) continue;
    const other = t.from === me ? t.to : t.to === me ? t.from : null;
    if (other) bump(friends, other);
  }
  return { items, added, newGroups, groups, friends, outside };
}

/** Whether a row in the activity feed ('e-<id>', 'p-…', 't-…', 'g-…') is new. Activity says "added", so edits don't count. */
export function activityIsNew(f: Fresh, activityId: string): boolean {
  const kind = activityId[0];
  const id = activityId.slice(2);
  if (kind === 'g') return f.newGroups.has(id);
  return f.added.has(`${kind}:${id}`);
}

/**
 * After a change you made yourself: the same view of what was seen, plus your
 * change, so it isn't marked new.
 */
export function acknowledge(seen: Seen, before: AppState, after: AppState): Seen {
  const b = fingerprints(before);
  const a = fingerprints(after);
  let next: Seen | null = null;
  for (const k of Object.keys(a)) {
    if (a[k] !== b[k] && seen[k] !== a[k]) {
      next ??= { ...seen };
      next[k] = a[k];
    }
  }
  for (const k of Object.keys(b)) {
    if (!(k in a) && k in seen) {
      next ??= { ...seen };
      delete next[k];
    }
  }
  return next ?? seen;
}

// ---------------------------------------------------------------------------
// Visits

/** A quick look at another app (a few seconds) doesn't count as leaving. */
export const AWAY_COUNTS_AFTER_MS = 30_000;

/**
 * Kept on the phone: what was seen at the start of this visit (`base`), and
 * what was on screen when the app was last put away (`left`), which becomes
 * the new `base` when you come back.
 */
export interface Visits {
  base: Seen | null;
  left: Seen | null;
}

/** Opening the app afresh (it had been closed): a new visit. */
export function startVisit(saved: Visits | null): Visits {
  return { base: saved?.left ?? saved?.base ?? null, left: null };
}

/** Coming back to the app after `awayMs`. */
export function comeBack(v: Visits, awayMs: number): Visits {
  return { base: awayMs >= AWAY_COUNTS_AFTER_MS && v.left ? v.left : v.base, left: null };
}
