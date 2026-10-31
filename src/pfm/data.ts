// Changing Money's data: every change is a list of items (one per account,
// category, record… or the settings), applied here and saved one row each.
// Pure functions, unit-tested.

import { commonCategories, defaultSettings } from './defaults';
import { dueDays, recordFor } from './logic';
import type { Account, Category, Item, ItemKind, MoneyData, MoneyRecord, MoneySettings, Repeat, SplitLink } from './types';
import type { CurrencyCode, Id } from '../types';

const COLLECTION: Record<Exclude<ItemKind, 'settings'>, 'accounts' | 'categories' | 'records' | 'repeats' | 'links'> = {
  account: 'accounts',
  category: 'categories',
  record: 'records',
  repeat: 'repeats',
  link: 'links',
};

export const KINDS: ItemKind[] = ['settings', 'account', 'category', 'record', 'repeat', 'link'];

/** Settings saved by an older version get the newer ones filled in. */
export function withDefaults(raw: Partial<MoneySettings> | null | undefined, currency?: CurrencyCode): MoneySettings {
  const d = defaultSettings(currency);
  if (!raw || typeof raw !== 'object') return d;
  return {
    ...d,
    ...raw,
    rates: { ...(raw.rates ?? {}) },
    usual: { ...(raw.usual ?? {}) },
    groupCategory: { ...(raw.groupCategory ?? {}) },
    tips: Array.isArray(raw.tips) ? raw.tips : [],
  };
}

/** Apply changes (data null = deleted). */
export function applyItems(m: MoneyData, items: Item[]): MoneyData {
  if (!items.length) return m;
  const next: MoneyData = { ...m };
  const copied = new Set<string>();
  for (const it of items) {
    if (it.kind === 'settings') {
      next.settings = applySetting(next.settings, it, m.settings.currency);
      continue;
    }
    const key = COLLECTION[it.kind];
    if (!key) continue;
    if (!copied.has(key)) {
      (next as unknown as Record<string, unknown>)[key] = { ...next[key] };
      copied.add(key);
    }
    const coll = next[key] as Record<string, unknown>;
    if (it.data === null) delete coll[it.id];
    else coll[it.id] = { ...(it.data as object), id: it.id };
  }
  return next;
}

/** Keep the latest change per item, in order. */
export function coalesce(queue: Item[], add: Item[]): Item[] {
  const ids = new Set(add.map((i) => `${i.kind}:${i.id}`));
  return [...queue.filter((i) => !ids.has(`${i.kind}:${i.id}`)), ...add];
}

export interface Row {
  id: string;
  kind: string;
  data: unknown;
  deleted: boolean;
}

export function rowsToItems(rows: Row[]): Item[] {
  return rows
    .filter((r) => (KINDS as string[]).includes(r.kind))
    .map((r) => ({ kind: r.kind as ItemKind, id: r.id, data: r.deleted ? null : r.data }));
}

// ---------------------------------------------------------------------------
// Items for common changes

// Settings are saved one setting per row ('settings.budget'), and the maps one
// entry per row ('settings.usual.<group>'), so two phones changing different
// settings never undo each other. (A whole-settings row, id 'settings', is
// still understood.)
const MAPS = ['usual', 'groupCategory', 'rates'] as const;
type MapKey = (typeof MAPS)[number];
const isMap = (k: string): k is MapKey => (MAPS as readonly string[]).includes(k);

function applySetting(s: MoneySettings, it: Item, currency: CurrencyCode): MoneySettings {
  if (it.id === 'settings') return withDefaults(it.data as Partial<MoneySettings> | null, currency);
  const [, key, entry] = it.id.split('.');
  if (!key || !(key in s)) return s;
  const value = it.data === null ? undefined : (it.data as { value: unknown }).value;
  if (isMap(key) && entry !== undefined) {
    const map = { ...(s[key] as Record<string, unknown>) };
    if (it.data === null) delete map[entry];
    else map[entry] = value;
    return { ...s, [key]: map };
  }
  if (it.data === null) return s;
  return { ...s, [key]: value };
}

/** Rows for what changed between two versions of the settings. */
export function settingsItems(prev: MoneySettings, next: MoneySettings): Item[] {
  const items: Item[] = [];
  for (const key of Object.keys(next) as (keyof MoneySettings)[]) {
    if (isMap(key)) {
      const a = (prev[key] ?? {}) as Record<string, unknown>;
      const b = (next[key] ?? {}) as Record<string, unknown>;
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (!(k in b)) items.push({ kind: 'settings', id: `settings.${key}.${k}`, data: null });
        else if (!(k in a) || a[k] !== b[k]) items.push({ kind: 'settings', id: `settings.${key}.${k}`, data: { value: b[k] } });
      }
    } else if (JSON.stringify(prev[key]) !== JSON.stringify(next[key])) {
      items.push({ kind: 'settings', id: `settings.${key}`, data: { value: next[key] } });
    }
  }
  return items;
}
export const accountItem = (a: Account): Item => ({ kind: 'account', id: a.id, data: a });
export const categoryItem = (c: Category): Item => ({ kind: 'category', id: c.id, data: c });
export const recordItem = (r: MoneyRecord): Item => ({ kind: 'record', id: r.id, data: r });
export const repeatItem = (r: Repeat): Item => ({ kind: 'repeat', id: r.id, data: r });
export const linkItem = (l: SplitLink): Item => ({ kind: 'link', id: l.id, data: l });

export function accountInUse(m: MoneyData, id: Id): boolean {
  return (
    Object.values(m.records).some((r) => r.accountId === id || r.toAccountId === id) ||
    Object.values(m.links).some((l) => l.accountId === id) ||
    Object.values(m.repeats).some((r) => r.template.accountId === id || r.template.toAccountId === id)
  );
}

/** Deleting an account: one with history is hidden (and can be brought back); an unused one goes. */
export function removeAccount(m: MoneyData, id: Id): Item[] {
  const a = m.accounts[id];
  if (!a) return [];
  const items: Item[] = accountInUse(m, id) ? [accountItem({ ...a, hidden: true })] : [{ kind: 'account', id, data: null }];
  // It's no longer anyone's usual account.
  const usual = Object.fromEntries(Object.entries(m.settings.usual).filter(([, v]) => v !== id));
  items.push(...settingsItems(m.settings, { ...m.settings, usual }));
  return items;
}

export function categoryInUse(m: MoneyData, id: Id): boolean {
  const ids = new Set([id, ...Object.values(m.categories).filter((c) => c.parentId === id).map((c) => c.id)]);
  return (
    Object.values(m.records).some((r) => r.categoryId && ids.has(r.categoryId)) ||
    Object.values(m.links).some((l) => l.categoryId && ids.has(l.categoryId)) ||
    Object.values(m.repeats).some((r) => r.template.categoryId && ids.has(r.template.categoryId)) ||
    Object.values(m.settings.groupCategory).some((c) => ids.has(c))
  );
}

/** Deleting a category (and its sub-categories): hidden when anything uses it, so old records keep their names. */
export function removeCategory(m: MoneyData, id: Id): Item[] {
  const c = m.categories[id];
  if (!c) return [];
  const all = [c, ...Object.values(m.categories).filter((x) => x.parentId === id)];
  return all.map((x) => (categoryInUse(m, x.id) ? categoryItem({ ...x, hidden: true }) : { kind: 'category' as const, id: x.id, data: null }));
}

/**
 * Turning Money on. The first time, today becomes the day group shares count
 * from; turning it on again later keeps that day. Common categories are
 * added when asked (and none exist yet), with any accounts picked at setup.
 */
export function turnOn(
  m: MoneyData,
  opts: { today: string; currency?: CurrencyCode; accounts?: Account[]; categories?: boolean },
): Item[] {
  const items: Item[] = [];
  const s = m.settings;
  items.push(
    ...settingsItems(s, {
      ...s,
      enabled: true,
      introSeen: true,
      startedOn: s.startedOn ?? opts.today,
      currency: s.startedOn ? s.currency : opts.currency ?? s.currency,
    }),
  );
  if (opts.categories && !Object.keys(m.categories).length) items.push(...commonCategories().map(categoryItem));
  for (const a of opts.accounts ?? []) items.push(accountItem(a));
  return items;
}

/** Records repeating transactions are due to make by today, and where each got to. */
export function repeatsDue(m: MoneyData, today: string, at: string): Item[] {
  const items: Item[] = [];
  for (const r of Object.values(m.repeats)) {
    const days = dueDays(r, today);
    if (!days.length) continue;
    for (const day of days) {
      const rec = recordFor(r, day, at);
      // Already made on another phone (and perhaps edited there): leave it.
      if (!m.records[rec.id]) items.push(recordItem(rec));
    }
    items.push(repeatItem({ ...r, lastMade: days[days.length - 1] }));
  }
  return items;
}
