// Money's sums: periods, currencies, balances, the list of what happened,
// totals, search, filters, stats and repeats. Pure functions, unit-tested.
//
// What counts:
// - Income and expenses you record yourself.
// - Your share of each group expense, from the day you turned Money on
//   (nothing earlier changes). Paying for friends isn't spending: only your
//   share is. Money friends pay you back isn't income either.
// - Account balances: the balance an account started with, plus what you
//   recorded in it, plus split expenses and settle-ups you said it paid or
//   received (only you see which account).

import { toDay } from '../dates';
import { friendBalances } from '../logic';
import { approxRate, formatMoney } from '../money';
import { fold } from '../search';
import type { AppState, CurrencyCode, Expense, Group, Id, Payment, Totals, Transfer } from '../types';
import { accountType } from './types';
import type { Account, Category, CategoryKind, FrozenEntry, MoneyData, MoneyRecord, MoneySettings, Repeat, RepeatEvery, SplitLink } from './types';

/** Shares with no category of their own or their group's. */
export const SPLIT_CATEGORY = 'split';
/** Records saved without a category. */
export const NO_CATEGORY = 'none';
/** The group key for expenses outside any group. */
export const OUTSIDE = 'outside';
/** In the groups filter: your own records (not from Split). */
export const OWN = 'own';

// ---------------------------------------------------------------------------
// Days and months

const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const dayOf = (y: number, m: number, d: number) => {
  const t = new Date(y, m, d);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
};
const parts = (day: string) => day.split('-').map(Number) as [number, number, number];
const daysIn = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

/** A month as labelled in Money (m is 0–11). */
export interface Ym {
  y: number;
  m: number;
}

export function addMonths(ym: Ym, n: number): Ym {
  const t = ym.y * 12 + ym.m + n;
  return { y: Math.floor(t / 12), m: ((t % 12) + 12) % 12 };
}

/** The first day of a month that starts on `start` (1–28). */
const monthFirst = (ym: Ym, start: number) => dayOf(ym.y, ym.m, Math.min(start, 28));

/** Which month a day belongs to when months start on `start`: with 25, 24 Oct is in September's month. */
export function monthOf(day: string, start = 1): Ym {
  const [y, m, d] = parts(day);
  const ym = { y, m: m - 1 };
  return d >= Math.min(start, 28) ? ym : addMonths(ym, -1);
}

/** The days of a month: from `from` up to (not including) `to`. */
export function monthRange(ym: Ym, start = 1): { from: string; to: string } {
  return { from: monthFirst(ym, start), to: monthFirst(addMonths(ym, 1), start) };
}

/** A whole year of months (starting on `start`). */
export function yearRange(y: number, start = 1): { from: string; to: string } {
  return { from: monthFirst({ y, m: 0 }, start), to: monthFirst({ y: y + 1, m: 0 }, start) };
}

/** "Oct 2026"; with months starting on another day, "25 Oct – 24 Nov". */
export function monthLabel(ym: Ym, start = 1): string {
  if (start <= 1) return `${MONTHS[ym.m]} ${ym.y}`;
  const { from, to } = monthRange(ym, start);
  const [, fm, fd] = parts(from);
  const last = new Date(parts(to)[0], parts(to)[1] - 1, parts(to)[2] - 1);
  return `${fd} ${MONTHS[fm - 1]} – ${last.getDate()} ${MONTHS[last.getMonth()]}`;
}

export const monthName = (m: number) => FULL_MONTHS[m];
export const shortMonth = (m: number) => MONTHS[m];

/** Weekday name for a day. */
export function weekday(day: string): string {
  const [y, m, d] = parts(day);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(y, m - 1, d).getDay()];
}

/** The weeks of a calendar month (each 7 days, null outside the month). */
export function calendarWeeks(ym: Ym, weekStart: 0 | 1 = 1): (string | null)[][] {
  const first = new Date(ym.y, ym.m, 1).getDay();
  const lead = (first - weekStart + 7) % 7;
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= daysIn(ym.y, ym.m); d++) cells.push(dayOf(ym.y, ym.m, d));
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// ---------------------------------------------------------------------------
// Currencies

/** How many main-currency units one unit of `code` is worth (a group's own rate when it shares the main currency). */
export function rateToMain(settings: MoneySettings, code: CurrencyCode, group?: Group | null): number {
  if (code === settings.currency) return 1;
  if (group && group.baseCurrency === settings.currency && group.rates?.[code]) return group.rates[code];
  return settings.rates[code] ?? approxRate(code, settings.currency);
}

export function toMain(settings: MoneySettings, amount: number, code: CurrencyCode, group?: Group | null): number {
  return code === settings.currency ? amount : Math.round(amount * rateToMain(settings, code, group));
}

/** An amount in one currency, in another (through the main currency). */
export function convert(settings: MoneySettings, amount: number, from: CurrencyCode, to: CurrencyCode, group?: Group | null): number {
  if (from === to) return amount;
  return Math.round((amount * rateToMain(settings, from, group)) / rateToMain(settings, to, group));
}

// ---------------------------------------------------------------------------
// Categories

const byOrder = <T extends { order: number; name: string }>(a: T, b: T) => a.order - b.order || a.name.localeCompare(b.name);

export function topCategories(cats: Record<Id, Category>, kind: CategoryKind, withHidden = false): Category[] {
  return Object.values(cats)
    .filter((c) => c.kind === kind && !c.parentId && (withHidden || !c.hidden))
    .sort(byOrder);
}

export function subCategories(cats: Record<Id, Category>, parentId: Id, withHidden = false): Category[] {
  return Object.values(cats)
    .filter((c) => c.parentId === parentId && (withHidden || !c.hidden))
    .sort(byOrder);
}

/** The top category a category belongs to (itself if it's one). */
export function topOf(cats: Record<Id, Category>, id: Id | null | undefined): Id {
  if (!id) return NO_CATEGORY;
  const c = cats[id];
  if (!c) return id === SPLIT_CATEGORY ? SPLIT_CATEGORY : NO_CATEGORY;
  return c.parentId && cats[c.parentId] ? c.parentId : c.id;
}

/** ["Car", "Fuel"], ["Food"], or a stand-in for shares and uncategorised records. */
export function categoryPath(cats: Record<Id, Category>, id: Id | null | undefined): string[] {
  if (id === SPLIT_CATEGORY) return ['Split with friends'];
  const c = id ? cats[id] : undefined;
  if (!c) return ['No category'];
  const parent = c.parentId ? cats[c.parentId] : undefined;
  return parent ? [parent.name, c.name] : [c.name];
}

export const categoryName = (cats: Record<Id, Category>, id: Id | null | undefined) => categoryPath(cats, id).join(' › ');

// ---------------------------------------------------------------------------
// The list: your records and what Split brings in

export type EntryKind =
  | 'expense' // you recorded it
  | 'income'
  | 'transfer' // between your own accounts
  | 'share' // your share of a split expense
  | 'paid' // you paid for friends, with no share yourself
  | 'settle'; // a settle-up or money between friends: neither income nor spending

export interface Entry {
  /** 'r:<record>', 'e:<expense>', 'p:<payment>', 't:<transfer>' (the last three are also link ids). */
  key: string;
  kind: EntryKind;
  date: string;
  day: string;
  /** What to show, in `currency` (always positive). */
  amount: number;
  currency: CurrencyCode;
  /** Counted in totals, in the main currency. */
  income: number;
  expense: number;
  /** A real category, SPLIT_CATEGORY or NO_CATEGORY (none for transfers and settle-ups). */
  categoryId: Id | null;
  accountId: Id | null;
  toAccountId: Id | null;
  /** A transfer: what arrived, in the receiving account's currency. */
  toAmount?: number;
  toCurrency?: CurrencyCode;
  note?: string;
  details?: string;
  /** Split: the group (null outside groups). */
  groupId: Id | null;
  split: boolean;
  /** Split: what it's called and the line under it. */
  title?: string;
  info?: string;
  /** Split: you paid or received money here but haven't said which account. */
  sortOut?: boolean;
  /** Kept from a group you left: its name then, and what it changed in its account. */
  groupLabel?: string;
  kept?: boolean;
  keptChange?: number;
  /** Your money that moved: the amount you paid (expense) or the settle-up (positive in, negative out). */
  moved?: number;
  record?: MoneyRecord;
  /** Split: the expense, payment or transfer itself. */
  bill?: Expense;
  payment?: Payment;
  transfer?: Transfer;
  /** Lower-case words to search in. */
  text: string;
}

const groupKey = (groupId: Id | null | undefined) => groupId ?? OUTSIDE;

/** Account effects of a record: [account, change] pairs. */
function recordMoves(r: MoneyRecord): [Id, number][] {
  if (r.kind === 'expense') return [[r.accountId, -r.amount]];
  if (r.kind === 'income') return [[r.accountId, r.amount]];
  const out: [Id, number][] = [[r.accountId, -r.amount]];
  if (r.toAccountId) out.push([r.toAccountId, r.toAmount ?? r.amount]);
  return out;
}

interface SplitMove {
  key: string;
  date: string;
  /** Your money that moved, in `currency` (negative: out). */
  amount: number;
  currency: CurrencyCode;
  group: Group | null;
}

/** Money of yours that moved through Split: expenses you paid, settle-ups and transfers you made or got. */
function splitMoves(s: AppState): SplitMove[] {
  const me = s.meId;
  if (!me) return [];
  const groups = new Map(s.groups.map((g) => [g.id, g]));
  const out: SplitMove[] = [];
  for (const e of s.expenses) {
    const paid = e.payers[me] ?? 0;
    if (paid > 0) out.push({ key: `e:${e.id}`, date: e.date, amount: -paid, currency: e.currency, group: e.groupId ? groups.get(e.groupId) ?? null : null });
  }
  for (const p of s.payments) {
    if (p.settlementId || (p.from !== me && p.to !== me) || p.from === p.to) continue;
    out.push({ key: `p:${p.id}`, date: p.date, amount: p.to === me ? p.amount : -p.amount, currency: p.currency, group: groups.get(p.groupId) ?? null });
  }
  for (const t of s.transfers) {
    if ((t.from !== me && t.to !== me) || t.from === t.to) continue;
    out.push({ key: `t:${t.id}`, date: t.date, amount: t.to === me ? t.amount : -t.amount, currency: t.currency, group: null });
  }
  return out;
}

/** What a linked split item changed in its account (in the account's currency). */
function linkedChange(m: MoneyData, move: SplitMove, link: SplitLink, acc: Account): number {
  const sign = move.amount < 0 ? -1 : 1;
  if (link.amount !== undefined && acc.currency !== move.currency) return sign * link.amount;
  return sign * convert(m.settings, Math.abs(move.amount), move.currency, acc.currency, move.group);
}

/** Every account's balance now, in its own currency. */
export function accountBalances(m: MoneyData, s: AppState): Record<Id, number> {
  const bal: Record<Id, number> = {};
  for (const a of Object.values(m.accounts)) bal[a.id] = a.opening;
  for (const r of Object.values(m.records)) {
    for (const [id, v] of recordMoves(r)) if (id in bal) bal[id] += v;
  }
  for (const move of splitMoves(s)) {
    const link = m.links[move.key];
    const acc = link?.accountId ? m.accounts[link.accountId] : undefined;
    if (link && acc) bal[acc.id] += linkedChange(m, move, link, acc);
  }
  // Kept from groups you left (no longer in Split): what they changed then.
  const live = liveKeys(s);
  for (const link of Object.values(m.links)) {
    if (link.frozen?.change === undefined || live.has(link.id) || !link.accountId || !(link.accountId in bal)) continue;
    bal[link.accountId] += link.frozen.change;
  }
  return bal;
}

/** Every expense, payment and transfer Split has now, as link keys. */
function liveKeys(s: AppState): Set<string> {
  return new Set([...s.expenses.map((e) => `e:${e.id}`), ...s.payments.map((p) => `p:${p.id}`), ...s.transfers.map((t) => `t:${t.id}`)]);
}

/** Is this account money you have (true) or owe (false)? Cards and loans are what you owe when negative. */
export const isLiability = (a: Account) => !!accountType(a.type).owed;

/** Assets, liabilities and their total, in the main currency. */
export function accountTotals(m: MoneyData, bal: Record<Id, number>): { assets: number; liabilities: number } {
  let assets = 0;
  let liabilities = 0;
  for (const a of Object.values(m.accounts)) {
    if (a.hidden && !bal[a.id]) continue;
    const v = toMain(m.settings, bal[a.id] ?? 0, a.currency);
    if (v >= 0) assets += v;
    else liabilities -= v;
  }
  return { assets, liabilities };
}

/** Split's balances as accounts: what friends owe you and what you owe them, in the main currency. */
export function fromSplit(m: MoneyData, s: AppState): { owedToYou: number; youOwe: number } {
  if (!s.meId) return { owedToYou: 0, youOwe: 0 };
  const fb = friendBalances(s.meId, s.groups, s.expenses, s.payments, s.transfers);
  let owedToYou = 0;
  let youOwe = 0;
  for (const t of Object.values(fb) as Totals[]) {
    for (const [c, v] of Object.entries(t)) {
      const x = toMain(m.settings, v, c);
      if (x > 0) owedToYou += x;
      else youOwe -= x;
    }
  }
  return { owedToYou, youOwe };
}

/** Everything in Money's list, newest first. */
export function buildEntries(m: MoneyData, s: AppState): Entry[] {
  const me = s.meId;
  const st = m.settings;
  const out: Entry[] = [];
  const accName = (id: Id | null | undefined) => (id && m.accounts[id] ? m.accounts[id].name : '');
  const catWords = (id: Id | null) => categoryPath(m.categories, id).join(' ');
  const groups = new Map(s.groups.map((g) => [g.id, g]));
  const groupName = (id: Id | null) => (id ? groups.get(id)?.name ?? 'A group' : 'No group');
  const nameOf = (id: Id) => (id === me ? 'You' : s.people[id]?.name ?? 'Someone');
  const anyAccount = Object.values(m.accounts).some((a) => !a.hidden);

  for (const r of Object.values(m.records)) {
    const acc = m.accounts[r.accountId];
    const code = acc?.currency ?? st.currency;
    const cat = r.kind === 'transfer' ? null : r.categoryId && m.categories[r.categoryId] ? r.categoryId : NO_CATEGORY;
    const main = toMain(st, r.amount, code);
    const to = r.toAccountId ? m.accounts[r.toAccountId] : undefined;
    out.push({
      key: `r:${r.id}`,
      kind: r.kind,
      date: r.date,
      day: toDay(r.date),
      amount: r.amount,
      currency: code,
      income: r.kind === 'income' ? main : 0,
      expense: r.kind === 'expense' ? main : 0,
      categoryId: cat,
      accountId: r.accountId,
      toAccountId: r.toAccountId ?? null,
      toAmount: r.kind === 'transfer' ? r.toAmount ?? r.amount : undefined,
      toCurrency: to?.currency,
      note: r.note,
      details: r.details,
      groupId: null,
      split: false,
      record: r,
      text: fold(
        [r.note, r.details, cat ? catWords(cat) : 'transfer', accName(r.accountId), accName(r.toAccountId), r.kind].filter(Boolean).join(' '),
      ),
    });
  }

  // Split: only from the day Money was turned on.
  if (!me || !st.startedOn) return sortEntries(out);
  const from = st.startedOn;
  const fresh = (date: string) => toDay(date) >= from;

  for (const e of s.expenses) {
    if (!fresh(e.date)) continue;
    const share = e.shares[me] ?? 0;
    const paid = e.payers[me] ?? 0;
    if (share <= 0 && paid <= 0) continue;
    const g = e.groupId ? groups.get(e.groupId) ?? null : null;
    const key = `e:${e.id}`;
    const link = m.links[key];
    const groupCat = st.groupCategory[groupKey(e.groupId)];
    const cat =
      link?.categoryId && m.categories[link.categoryId]
        ? link.categoryId
        : groupCat && m.categories[groupCat]
          ? groupCat
          : SPLIT_CATEGORY;
    const payers = Object.keys(e.payers);
    const others = payers.filter((id) => id !== me);
    let info: string;
    if (paid > 0) {
      const from = link?.accountId ? ` from ${accName(link.accountId)}` : '';
      info = share > 0 ? `Your share · you paid ${fmt(paid, e.currency)}${from}` : `You paid for friends${from}`;
    } else {
      info = `Your share · ${others.length === 1 ? nameOf(others[0]) : `${others.length} people`} paid ${fmt(e.amount, e.currency)}`;
    }
    const needs = paid > 0 && !link && anyAccount && st.usual[groupKey(e.groupId)] !== null;
    out.push({
      key,
      kind: share > 0 ? 'share' : 'paid',
      date: e.date,
      day: toDay(e.date),
      amount: share > 0 ? share : paid,
      currency: e.currency,
      income: 0,
      expense: share > 0 ? toMain(st, share, e.currency, g) : 0,
      categoryId: share > 0 ? cat : null,
      accountId: link?.accountId ?? null,
      toAccountId: null,
      groupId: e.groupId,
      split: true,
      title: e.description,
      info,
      sortOut: needs,
      moved: paid > 0 ? -paid : undefined,
      note: e.note,
      bill: e,
      text: fold([e.description, e.note, groupName(e.groupId), share > 0 ? catWords(cat) : '', accName(link?.accountId), ...payers.map(nameOf), 'split'].filter(Boolean).join(' ')),
    });
  }

  const settle = (
    key: string,
    date: string,
    amount: number,
    code: CurrencyCode,
    title: string,
    groupId: Id | null,
    extra: Partial<Entry>,
    words: string[],
  ) => {
    const link = m.links[key];
    const incoming = amount > 0;
    const acc = link?.accountId ? accName(link.accountId) : '';
    const where = groupId ? groupName(groupId) : 'Between friends';
    out.push({
      key,
      kind: 'settle',
      date,
      day: toDay(date),
      amount: Math.abs(amount),
      currency: code,
      income: 0,
      expense: 0,
      categoryId: null,
      accountId: link?.accountId ?? null,
      toAccountId: null,
      groupId,
      split: true,
      title,
      info: acc ? (incoming ? `${where} → ${acc}` : `${acc} → ${where}`) : link ? `${where} · not tracked` : where,
      sortOut: !link && anyAccount && st.usual[groupKey(groupId)] !== null,
      moved: amount,
      text: fold([title, where, acc, ...words, 'settle up'].join(' ')),
      ...extra,
    });
  };

  for (const p of s.payments) {
    if (p.settlementId || (p.from !== me && p.to !== me) || p.from === p.to || !fresh(p.date)) continue;
    const incoming = p.to === me;
    const title = incoming ? `${nameOf(p.from)} paid you back` : `You paid ${nameOf(p.to)} back`;
    settle(`p:${p.id}`, p.date, incoming ? p.amount : -p.amount, p.currency, title, p.groupId, { payment: p }, [nameOf(p.from), nameOf(p.to)]);
  }
  for (const t of s.transfers) {
    if ((t.from !== me && t.to !== me) || t.from === t.to || !fresh(t.date)) continue;
    const incoming = t.to === me;
    const other = nameOf(incoming ? t.from : t.to);
    const title =
      t.kind === 'settlement'
        ? incoming
          ? `${other} settled up with you`
          : `You settled up with ${other}`
        : incoming
          ? `${other} gave you`
          : `You gave ${other}`;
    settle(`t:${t.id}`, t.date, incoming ? t.amount : -t.amount, t.currency, title, null, { transfer: t, note: t.note }, [other, t.note ?? '']);
  }

  // Kept from groups you left: still counted as they were.
  const live = liveKeys(s);
  for (const l of Object.values(m.links)) {
    const f = l.frozen;
    if (!f || live.has(l.id) || toDay(f.date) < from) continue;
    const cat = f.kind === 'share' ? (l.categoryId && m.categories[l.categoryId] ? l.categoryId : f.categoryId && m.categories[f.categoryId] ? f.categoryId : SPLIT_CATEGORY) : null;
    out.push({
      key: l.id,
      kind: f.kind,
      date: f.date,
      day: toDay(f.date),
      amount: f.amount,
      currency: f.currency,
      income: 0,
      expense: f.kind === 'share' ? f.expense : 0,
      categoryId: cat,
      accountId: l.accountId,
      toAccountId: null,
      groupId: f.groupId,
      groupLabel: f.groupName,
      split: true,
      title: f.title,
      info: f.info,
      moved: f.moved,
      kept: true,
      keptChange: f.change,
      text: fold([f.title, f.info, f.groupName, cat ? catWords(cat) : '', accName(l.accountId), 'split'].filter(Boolean).join(' ')),
    });
  }
  return sortEntries(out);
}

/** What Money counted for a split entry, to keep when it leaves Split (you leave the group). */
export function freeze(m: MoneyData, s: AppState, e: Entry): FrozenEntry | null {
  if (!e.split || e.kept || (e.kind !== 'share' && e.kind !== 'paid' && e.kind !== 'settle')) return null;
  const g = e.groupId ? s.groups.find((x) => x.id === e.groupId) : undefined;
  return {
    kind: e.kind,
    date: e.date,
    amount: e.amount,
    currency: e.currency,
    expense: e.expense,
    title: e.title ?? '',
    info: e.info ?? '',
    groupId: e.groupId,
    groupName: g?.name ?? (e.groupId ? 'A group you left' : 'Between friends'),
    categoryId: e.categoryId && e.categoryId !== SPLIT_CATEGORY ? e.categoryId : null,
    moved: e.moved,
    change: e.accountId ? changeIn(m, s, e, e.accountId) : undefined,
  };
}

const fmt = (minor: number, code: CurrencyCode) => formatMoney(minor, code);

const sortEntries = (list: Entry[]) => list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.key < b.key ? 1 : -1));

/** Entries on days from `from` up to (not including) `to`. */
export const inRange = (list: Entry[], from: string, to: string) => list.filter((e) => e.day >= from && e.day < to);

export interface Sums {
  income: number;
  expense: number;
  /** Income minus spending. */
  net: number;
  count: number;
}

export function sums(list: Entry[]): Sums {
  let income = 0;
  let expense = 0;
  for (const e of list) {
    income += e.income;
    expense += e.expense;
  }
  return { income, expense, net: income - expense, count: list.length };
}

export interface Day {
  day: string;
  income: number;
  expense: number;
  entries: Entry[];
}

/** Entries by day, newest first, with each day's income and spending. */
export function byDay(list: Entry[]): Day[] {
  const days: Day[] = [];
  let cur: Day | null = null;
  for (const e of list) {
    if (!cur || cur.day !== e.day) {
      cur = { day: e.day, income: 0, expense: 0, entries: [] };
      days.push(cur);
    }
    cur.income += e.income;
    cur.expense += e.expense;
    cur.entries.push(e);
  }
  return days;
}

// ---------------------------------------------------------------------------
// Search and filters

/** Every word typed appears somewhere (note, details, category, account, group, people). */
export function matches(e: Entry, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return words.every((w) => e.text.includes(w));
}

export interface MoneyFilter {
  /** null: everything; else the categories ticked (a top one includes its sub-categories). */
  income: Id[] | null;
  expense: Id[] | null;
  accounts: Id[] | null;
  /** Group ids, OUTSIDE (with friends, no group) and OWN (your own records). */
  groups: string[] | null;
}

export const NO_FILTER: MoneyFilter = { income: null, expense: null, accounts: null, groups: null };

export const isFiltered = (f: MoneyFilter) => f.income !== null || f.expense !== null || f.accounts !== null || f.groups !== null;

function catIn(list: Id[] | null, cats: Record<Id, Category>, id: Id | null): boolean {
  if (list === null) return true;
  if (!id) return false;
  return list.includes(id) || list.includes(topOf(cats, id));
}

export function passes(e: Entry, f: MoneyFilter, cats: Record<Id, Category>): boolean {
  if (f.accounts !== null) {
    const hit = (e.accountId && f.accounts.includes(e.accountId)) || (e.toAccountId && f.accounts.includes(e.toAccountId));
    if (!hit) return false;
  }
  const kindsFiltered = f.income !== null || f.expense !== null;
  switch (e.kind) {
    case 'income':
      return catIn(f.income, cats, e.categoryId) && (f.groups === null || f.groups.includes(OWN)) && (f.income !== null || f.expense === null);
    case 'expense':
      return catIn(f.expense, cats, e.categoryId) && (f.groups === null || f.groups.includes(OWN)) && (f.expense !== null || f.income === null);
    case 'share':
      return catIn(f.expense, cats, e.categoryId) && (f.groups === null || f.groups.includes(groupKey(e.groupId))) && (f.expense !== null || f.income === null);
    case 'paid':
    case 'settle':
      return !kindsFiltered && (f.groups === null || f.groups.includes(groupKey(e.groupId)));
    case 'transfer':
      return !kindsFiltered && f.groups === null;
  }
}

/** "Car: EMI, Fuel" — what a filter shows, in a few words. */
export function describeFilter(f: MoneyFilter, m: MoneyData, groupName: (id: string) => string): string {
  const bits: string[] = [];
  const cats = (ids: Id[]) => {
    const tops = new Map<Id, string[]>();
    for (const id of ids) {
      const top = topOf(m.categories, id);
      const list = tops.get(top) ?? [];
      if (id !== top) list.push(m.categories[id]?.name ?? '');
      tops.set(top, list);
    }
    return [...tops.entries()].map(([top, subs]) => {
      const name = categoryPath(m.categories, top)[0];
      return subs.length ? `${name}: ${subs.join(', ')}` : name;
    });
  };
  if (f.expense !== null) bits.push(...(f.expense.length ? cats(f.expense) : ['No spending']));
  if (f.income !== null) bits.push(...(f.income.length ? cats(f.income) : ['No income']));
  if (f.accounts !== null) bits.push(f.accounts.map((id) => m.accounts[id]?.name ?? '').join(', ') || 'No accounts');
  if (f.groups !== null) bits.push(f.groups.map((g) => (g === OWN ? 'My own' : g === OUTSIDE ? 'No group' : groupName(g))).join(', ') || 'No groups');
  return bits.join(' · ');
}

// ---------------------------------------------------------------------------
// Stats

export interface CategoryTotal {
  id: Id;
  name: string;
  total: number;
  /** Of it, your shares in groups: [group id or OUTSIDE, amount]. */
  shares: [string, number][];
  subs: { id: Id; name: string; total: number }[];
}

/** Spending (or income) by top category, biggest first, in the main currency. */
export function byCategory(list: Entry[], cats: Record<Id, Category>, kind: CategoryKind = 'expense'): CategoryTotal[] {
  const tops = new Map<Id, CategoryTotal>();
  for (const e of list) {
    const v = kind === 'expense' ? e.expense : e.income;
    if (!v) continue;
    const topId = topOf(cats, e.categoryId);
    const t = tops.get(topId) ?? { id: topId, name: categoryPath(cats, topId)[0], total: 0, shares: [], subs: [] };
    t.total += v;
    if (e.kind === 'share') {
      const g = groupKey(e.groupId);
      const hit = t.shares.find(([id]) => id === g);
      if (hit) hit[1] += v;
      else t.shares.push([g, v]);
    }
    if (e.categoryId && e.categoryId !== topId) {
      const sub = t.subs.find((x) => x.id === e.categoryId);
      if (sub) sub.total += v;
      else t.subs.push({ id: e.categoryId, name: cats[e.categoryId]?.name ?? '', total: v });
    }
    tops.set(topId, t);
  }
  const list2 = [...tops.values()];
  for (const t of list2) {
    t.shares.sort((a, b) => b[1] - a[1]);
    t.subs.sort((a, b) => b.total - a.total);
  }
  return list2.sort((a, b) => b.total - a.total);
}

// ---------------------------------------------------------------------------
// Repeats

/** The day of the n-th time something repeats (a monthly one on the 31st falls on the 30th in shorter months). */
export function nthDay(start: string, every: RepeatEvery, n: number): string {
  const [y, m, d] = parts(start);
  if (every === 'day') return dayOf(y, m - 1, d + n);
  if (every === 'week') return dayOf(y, m - 1, d + 7 * n);
  if (every === 'month') {
    const ym = addMonths({ y, m: m - 1 }, n);
    return dayOf(ym.y, ym.m, Math.min(d, daysIn(ym.y, ym.m)));
  }
  const yy = y + n;
  return dayOf(yy, m - 1, Math.min(d, daysIn(yy, m - 1)));
}

/** Days a repeat is due on, after the last one made, up to `today`. */
export function dueDays(r: Repeat, today: string): string[] {
  const limit = r.until && r.until < today ? r.until : today;
  const out: string[] = [];
  for (let n = 0; n < 5000; n++) {
    const day = nthDay(r.start, r.every, n);
    if (day > limit) break;
    if (!r.lastMade || day > r.lastMade) out.push(day);
  }
  return out;
}

/** The next day it will be made. */
export function nextDue(r: Repeat, today: string): string | null {
  for (let n = 0; n < 5000; n++) {
    const day = nthDay(r.start, r.every, n);
    if (r.until && day > r.until) return null;
    if (day > today && (!r.lastMade || day > r.lastMade)) return day;
  }
  return null;
}

/** The record a repeat makes on a day (its id is fixed, so two phones never make it twice). */
export function recordFor(r: Repeat, day: string, at: string): MoneyRecord {
  const [y, m, d] = parts(day);
  return {
    ...r.template,
    id: `${r.id}-${day}`,
    date: new Date(y, m - 1, d, 12).toISOString(),
    repeatId: r.id,
    createdAt: at,
    updatedAt: at,
  };
}

export const EVERY_LABEL: Record<RepeatEvery, string> = { day: 'Every day', week: 'Every week', month: 'Every month', year: 'Every year' };

// ---------------------------------------------------------------------------
// Notes you've used before, for suggestions while typing

export function noteSuggestions(m: MoneyData, typed: string, categoryId: Id | null | undefined, limit = 4): string[] {
  const q = fold(typed);
  if (!q) return [];
  const seen = new Map<string, { note: string; score: number }>();
  for (const r of Object.values(m.records)) {
    if (!r.note) continue;
    const f = fold(r.note);
    if (!f.startsWith(q) && !f.includes(` ${q}`)) continue;
    if (f === q) continue;
    const score = (r.categoryId && r.categoryId === categoryId ? 1e13 : 0) + new Date(r.date).getTime();
    const prev = seen.get(f);
    if (!prev || prev.score < score) seen.set(f, { note: r.note, score });
  }
  return [...seen.values()].sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.note);
}

/** Accounts in display order (by type, then your order). */
export function sortedAccounts(m: MoneyData, withHidden = false): Account[] {
  const typeIndex = (a: Account) => ['cash', 'bank', 'card', 'wallet', 'travel', 'investment', 'lent', 'loan', 'other'].indexOf(a.type);
  return Object.values(m.accounts)
    .filter((a) => withHidden || !a.hidden)
    .sort((a, b) => typeIndex(a) - typeIndex(b) || a.order - b.order || a.name.localeCompare(b.name));
}

/** The account to suggest for a group (or outside groups): the usual one, else the first account. undefined = Don't track. */
export function suggestedAccount(m: MoneyData, groupId: Id | null, currency?: CurrencyCode): Id | null | undefined {
  const key = groupKey(groupId);
  const usual = m.settings.usual[key];
  if (usual === null) return null;
  if (usual && m.accounts[usual] && !m.accounts[usual].hidden) return usual;
  const list = sortedAccounts(m);
  return (currency ? list.find((a) => a.currency === currency) : undefined)?.id ?? list[0]?.id;
}

/**
 * What an entry changed in one account, in that account's currency (positive:
 * money in). Matches accountBalances: a transfer counts out of one account and
 * into the other; a split item counts only in the account you said it used.
 */
export function changeIn(m: MoneyData, s: AppState, e: Entry, accountId: Id): number {
  const acc = m.accounts[accountId];
  if (!acc) return 0;
  const r = e.record;
  if (r) {
    let v = 0;
    for (const [id, x] of recordMoves(r)) if (id === accountId) v += x;
    return v;
  }
  if (!e.split || e.accountId !== accountId || !e.moved) return 0;
  if (e.kept) return e.keptChange ?? 0;
  const link = m.links[e.key];
  const group = e.groupId ? s.groups.find((g) => g.id === e.groupId) ?? null : null;
  const move: SplitMove = { key: e.key, date: e.date, amount: e.moved, currency: e.currency, group };
  return link ? linkedChange(m, move, link, acc) : 0;
}
