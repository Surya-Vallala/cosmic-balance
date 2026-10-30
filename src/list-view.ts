// Long lists of expenses: grouping by day (or month), finding by typing, and
// "only the ones I'm in". Pure functions, so they can be tested.

import { dayLabel, toDay } from './dates';
import { formatMoney } from './money';
import { fold } from './search';
import type { CurrencyCode } from './types';

export type SectionBy = 'day' | 'month';

export interface Section<T> {
  key: string;
  label: string;
  items: T[];
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "2026-10-21" for a day, "2026-10" for a month (on this phone's calendar). */
export function sectionKey(iso: string, by: SectionBy): string {
  const day = toDay(iso);
  return by === 'day' ? day : day.slice(0, 7);
}

/** "Today", "Tue, 21 Oct"… for a day; "October", or "October 2025" in another year, for a month. */
export function sectionLabel(key: string, by: SectionBy, now: Date = new Date()): string {
  if (by === 'day') return dayLabel(key, now);
  const [y, m] = key.split('-').map(Number);
  return y === now.getFullYear() ? MONTHS[m - 1] : `${MONTHS[m - 1]} ${y}`;
}

/** Days for a trip; months once a list spans more than this many days. */
export const DAYS_FOR_DAY_SECTIONS = 45;

/** By day when everything is within a few weeks (a trip), by month otherwise (a flat, a long-running group). */
export function sectionsBy(items: { date: string }[]): SectionBy {
  if (items.length === 0) return 'day';
  let lo = Infinity;
  let hi = -Infinity;
  for (const i of items) {
    const t = Date.parse(i.date);
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  }
  return hi - lo <= DAYS_FOR_DAY_SECTIONS * 86400000 ? 'day' : 'month';
}

/** Items (newest first) in sections, keeping their order. */
export function sections<T extends { date: string }>(items: T[], by: SectionBy, now: Date = new Date()): Section<T>[] {
  const out: Section<T>[] = [];
  const byKey = new Map<string, Section<T>>();
  for (const it of items) {
    const key = sectionKey(it.date, by);
    let s = byKey.get(key);
    if (!s) {
      s = { key, label: sectionLabel(key, by, now), items: [] };
      byKey.set(key, s);
      out.push(s);
    }
    s.items.push(it);
  }
  return out;
}

/** Words for finding something by its date: ["wednesday", "21", "oct", "october", "2026"]. */
export function dateWords(iso: string): string[] {
  const d = new Date(iso);
  return [WEEKDAYS[d.getDay()], String(d.getDate()), SHORT[d.getMonth()], MONTHS[d.getMonth()], String(d.getFullYear())].map(fold);
}

/** "1800", "1,800", "₹1,800" or "18.50" as hundredths; null for anything else. */
function typedAmount(word: string): { value: number; whole: boolean } | null {
  const n = word.replace(/^[^\d.]+/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(n)) return null;
  return { value: Math.round(parseFloat(n) * 100), whole: !n.includes('.') };
}

/**
 * Whether something matches what was typed: every word must be found in its
 * text (description, remarks, names), its date ("21", "oct", "tuesday",
 * "2026": whole words, so "26" isn't found in 2026) or as one of its amounts
 * ("1800" finds ₹1,800 and ₹1,800.50; "1800.5" only ₹1,800.50). Nothing typed
 * matches everything.
 */
export function matchesSearch(
  query: string,
  texts: (string | null | undefined)[],
  amounts: number[] = [],
  dates: string[] = [],
): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = texts.filter((t): t is string => !!t).map(fold);
  const days = dates.flatMap(dateWords);
  return words.every((w) => {
    if (hay.some((h) => h.includes(w))) return true;
    const isNumber = /^\d+$/.test(w);
    if (days.some((t) => t === w || (!isNumber && w.length >= 3 && t.startsWith(w)))) return true;
    const a = typedAmount(w);
    if (!a) return false;
    return amounts.some((x) => {
      const v = Math.abs(x);
      return v === a.value || (a.whole && Math.floor(v / 100) === a.value / 100);
    });
  });
}

export type ItemKind = 'expense' | 'payment' | 'transfer' | 'settlement';
const NOUNS: Record<ItemKind, [string, string]> = {
  expense: ['expense', 'expenses'],
  payment: ['payment', 'payments'],
  transfer: ['transfer', 'transfers'],
  settlement: ['settle-up', 'settle-ups'],
};

/**
 * What a section holds: "3 expenses · ₹4,200", "2 expenses, 1 payment · ₹900",
 * "1 transfer". The total is what was spent (expenses only), per currency.
 */
export function sectionSummary(items: { kind: ItemKind; spent?: { amount: number; currency: CurrencyCode } }[]): string {
  const counts = new Map<ItemKind, number>();
  const totals = new Map<CurrencyCode, number>();
  for (const it of items) {
    counts.set(it.kind, (counts.get(it.kind) ?? 0) + 1);
    if (it.spent) totals.set(it.spent.currency, (totals.get(it.spent.currency) ?? 0) + it.spent.amount);
  }
  const parts = (['expense', 'payment', 'transfer', 'settlement'] as ItemKind[])
    .filter((k) => counts.get(k))
    .map((k) => `${counts.get(k)} ${NOUNS[k][counts.get(k) === 1 ? 0 : 1]}`);
  const money = [...totals].filter(([, v]) => v !== 0).map(([c, v]) => formatMoney(v, c));
  return [parts.join(', '), money.join(' + ')].filter(Boolean).join(' · ');
}
