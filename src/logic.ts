// Pure money logic: splitting expenses, converting currencies, computing
// balances and simplifying debts. No React here so it can be unit-tested.
//
// Each expense keeps the currency it was paid in. To work out who owes whom,
// a group converts everything to its main currency at the rates the group set.

import { formatMoney, parseNumber, parseRupees } from './money';
import type { AppState, CurrencyCode, Debt, Expense, Group, Id, Payment, SplitType, Totals, Transfer } from './types';

/**
 * Split `total` in proportion to `weights` so the parts are whole hundredths
 * and always add up exactly to `total` (largest-remainder method).
 */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const parts = raw.map((r) => Math.floor(r + 1e-9));
  let remainder = total - parts.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r + 1e-9) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; remainder > 0 && order.length > 0; k = (k + 1) % order.length) {
    parts[order[k].i] += 1;
    remainder -= 1;
  }
  return parts;
}

export type SplitResult = { ok: true; shares: Record<Id, number> } | { ok: false; error: string };

/**
 * Work out each participant's share of an expense.
 * `inputs` holds what the user typed per person: amounts for 'exact',
 * percentages for 'percent', share counts for 'shares'. Ignored for 'equal'.
 */
export function computeSplit(
  amount: number,
  splitType: SplitType,
  participants: Id[],
  inputs: Record<Id, string>,
  currency: CurrencyCode = 'INR',
): SplitResult {
  if (!(amount > 0)) return { ok: false, error: `Enter an amount above ${formatMoney(0, currency)}.` };
  if (participants.length === 0) return { ok: false, error: 'Choose at least one person to split with.' };

  const toShares = (parts: number[]) => {
    const shares: Record<Id, number> = {};
    participants.forEach((id, i) => {
      if (parts[i] > 0) shares[id] = parts[i];
    });
    return shares;
  };

  if (splitType === 'equal') {
    return { ok: true, shares: toShares(allocate(amount, participants.map(() => 1))) };
  }

  if (splitType === 'exact') {
    const values: number[] = [];
    for (const id of participants) {
      const raw = (inputs[id] ?? '').trim();
      const v = raw === '' ? 0 : parseRupees(raw);
      if (v === null) return { ok: false, error: `“${raw}” isn't a valid amount.` };
      values.push(v);
    }
    const sum = values.reduce((a, b) => a + b, 0);
    if (sum < amount) return { ok: false, error: `${formatMoney(amount - sum, currency)} still to assign.` };
    if (sum > amount) return { ok: false, error: `${formatMoney(sum - amount, currency)} more than the total.` };
    return { ok: true, shares: toShares(values) };
  }

  // percent or shares: proportional weights
  const weights: number[] = [];
  for (const id of participants) {
    const raw = (inputs[id] ?? '').trim();
    const v = raw === '' ? 0 : parseNumber(raw);
    if (v === null) return { ok: false, error: `“${raw}” isn't a valid number.` };
    weights.push(v);
  }
  const sum = weights.reduce((a, b) => a + b, 0);

  if (splitType === 'percent') {
    const diff = Math.round((100 - sum) * 100) / 100;
    if (diff > 0) return { ok: false, error: `${diff}% still to assign.` };
    if (diff < 0) return { ok: false, error: `${-diff}% over 100%.` };
  } else if (sum <= 0) {
    return { ok: false, error: 'Give at least one person a share.' };
  }
  return { ok: true, shares: toShares(allocate(amount, weights)) };
}

/**
 * Validate what each person paid towards an expense. Blank means nothing.
 * The amounts must add up to the expense total.
 */
export function computePayers(
  amount: number,
  people: Id[],
  inputs: Record<Id, string>,
  currency: CurrencyCode = 'INR',
): { ok: true; payers: Record<Id, number> } | { ok: false; error: string } {
  if (!(amount > 0)) return { ok: false, error: 'Enter the total first.' };
  const payers: Record<Id, number> = {};
  let sum = 0;
  for (const id of people) {
    const raw = (inputs[id] ?? '').trim();
    if (raw === '') continue;
    const v = parseRupees(raw);
    if (v === null) return { ok: false, error: `“${raw}” isn't a valid amount.` };
    if (v > 0) payers[id] = v;
    sum += v;
  }
  if (Object.keys(payers).length === 0) return { ok: false, error: 'Enter how much each person paid.' };
  if (sum < amount)
    return { ok: false, error: `${formatMoney(amount - sum, currency)} of the total isn't paid by anyone yet.` };
  if (sum > amount)
    return { ok: false, error: `Payments add up to ${formatMoney(sum - amount, currency)} more than the total.` };
  return { ok: true, payers };
}

// ---------------------------------------------------------------------------
// Currencies

/** The group's currencies, main currency first. */
export function groupCurrencies(group: Group): CurrencyCode[] {
  return [group.baseCurrency, ...Object.keys(group.rates ?? {}).filter((c) => c !== group.baseCurrency)];
}

/** How many main-currency units one unit of `code` is worth in this group. */
export function rateOf(group: Group, code: CurrencyCode): number {
  if (code === group.baseCurrency) return 1;
  return group.rates?.[code] ?? 1;
}

/** Convert an amount in `code` to the group's main currency. */
export function toBase(group: Group, amount: number, code: CurrencyCode): number {
  return Math.round(amount * rateOf(group, code));
}

/** Convert a main-currency amount into `code`. */
export function fromBase(group: Group, baseAmount: number, code: CurrencyCode): number {
  return Math.round(baseAmount / rateOf(group, code));
}

/**
 * Express an expense in the group's main currency. The total is converted
 * once, then payers and shares are re-divided in proportion, so they still
 * add up exactly to the converted total.
 */
export function convertExpense(group: Group, e: Expense): Expense {
  if (e.currency === group.baseCurrency) return e;
  const total = toBase(group, e.amount, e.currency);
  const reweigh = (rec: Record<Id, number>) => {
    const ids = Object.keys(rec);
    const parts = allocate(total, ids.map((id) => rec[id]));
    return Object.fromEntries(ids.map((id, i) => [id, parts[i]]));
  };
  return { ...e, currency: group.baseCurrency, amount: total, payers: reweigh(e.payers), shares: reweigh(e.shares) };
}

/** A group's expenses (converted to its main currency) and payments. */
export function groupLedger(group: Group, expenses: Expense[], payments: Payment[]) {
  return {
    expenses: expenses.filter((e) => e.groupId === group.id).map((e) => convertExpense(group, e)),
    payments: payments.filter((p) => p.groupId === group.id),
  };
}

// ---------------------------------------------------------------------------
// Balances (all amounts here are in one currency: the group's main one)

/**
 * Net balance per person: positive means the group owes them money,
 * negative means they owe the group.
 */
export function netBalances(expenses: Expense[], payments: Payment[]): Record<Id, number> {
  const net: Record<Id, number> = {};
  const add = (id: Id, v: number) => {
    net[id] = (net[id] ?? 0) + v;
  };
  for (const e of expenses) {
    for (const [id, paid] of Object.entries(e.payers)) add(id, paid);
    for (const [id, share] of Object.entries(e.shares)) add(id, -share);
  }
  for (const p of payments) {
    add(p.from, p.baseAmount);
    add(p.to, -p.baseAmount);
  }
  return net;
}

/**
 * Turn net balances into the smallest practical set of payments: repeatedly
 * match the person owed the most with the person who owes the most.
 * At most (people − 1) payments.
 */
export function simplifyDebts(net: Record<Id, number>): Debt[] {
  const creditors = Object.entries(net)
    .filter(([, v]) => v > 0)
    .map(([id, v]) => ({ id, v }));
  const debtors = Object.entries(net)
    .filter(([, v]) => v < 0)
    .map(([id, v]) => ({ id, v: -v }));
  const byAmount = (a: { id: Id; v: number }, b: { id: Id; v: number }) => b.v - a.v || (a.id < b.id ? -1 : 1);
  const debts: Debt[] = [];
  creditors.sort(byAmount);
  debtors.sort(byAmount);
  while (creditors.length && debtors.length) {
    const c = creditors[0];
    const d = debtors[0];
    const amt = Math.min(c.v, d.v);
    debts.push({ from: d.id, to: c.id, amount: amt });
    c.v -= amt;
    d.v -= amt;
    if (c.v === 0) creditors.shift();
    if (d.v === 0) debtors.shift();
    creditors.sort(byAmount);
    debtors.sort(byAmount);
  }
  return debts;
}

/**
 * Who owes whom for a single expense. Each person's share is owed to the
 * payers in proportion to what each of them paid. Shares are handed out one
 * person at a time against what each payer is still owed, so every payer gets
 * back exactly what they paid (no stray paise from rounding).
 */
export function expenseOwes(e: Expense): Debt[] {
  const payerIds = Object.keys(e.payers).filter((id) => e.payers[id] > 0);
  const remaining = payerIds.map((id) => e.payers[id]);
  const out: Debt[] = [];
  for (const [id, share] of Object.entries(e.shares)) {
    if (share <= 0) continue;
    const parts = allocate(share, remaining);
    parts.forEach((part, i) => {
      remaining[i] -= part;
      if (part > 0 && payerIds[i] !== id) out.push({ from: id, to: payerIds[i], amount: part });
    });
  }
  return out;
}

/**
 * Debts without simplification: each person owes whoever paid for them,
 * netted only between the same two people.
 */
export function pairwiseDebts(expenses: Expense[], payments: Payment[]): Debt[] {
  const owes = new Map<string, number>(); // key "a|b" = a owes b
  const add = (a: Id, b: Id, v: number) => {
    if (a === b) return;
    const k = `${a}|${b}`;
    owes.set(k, (owes.get(k) ?? 0) + v);
  };
  for (const e of expenses) {
    for (const d of expenseOwes(e)) add(d.from, d.to, d.amount);
  }
  for (const p of payments) add(p.from, p.to, -p.baseAmount);

  const seen = new Set<string>();
  const debts: Debt[] = [];
  for (const key of owes.keys()) {
    const [a, b] = key.split('|');
    const pair = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    const net = (owes.get(`${a}|${b}`) ?? 0) - (owes.get(`${b}|${a}`) ?? 0);
    if (net > 0) debts.push({ from: a, to: b, amount: net });
    else if (net < 0) debts.push({ from: b, to: a, amount: -net });
  }
  return debts.sort((x, y) => y.amount - x.amount);
}

/** Who should pay whom in a group (main currency), honouring the simplify setting. */
export function groupDebts(group: Group, expenses: Expense[], payments: Payment[]): Debt[] {
  const l = groupLedger(group, expenses, payments);
  return group.simplifyDebts ? simplifyDebts(netBalances(l.expenses, l.payments)) : pairwiseDebts(l.expenses, l.payments);
}

/** Net balance per person in a group, in its main currency. */
export function groupNet(group: Group, expenses: Expense[], payments: Payment[]): Record<Id, number> {
  const l = groupLedger(group, expenses, payments);
  return netBalances(l.expenses, l.payments);
}

/** My balance with one friend inside one group (positive = they owe me). */
export function pairBalanceInGroup(
  meId: Id,
  friendId: Id,
  group: Group,
  expenses: Expense[],
  payments: Payment[],
): number {
  let amount = 0;
  for (const d of groupDebts(group, expenses, payments)) {
    if (d.from === friendId && d.to === meId) amount += d.amount;
    if (d.from === meId && d.to === friendId) amount -= d.amount;
  }
  return amount;
}

/**
 * My balance with each friend outside groups (positive = they owe me), per
 * currency. It counts transfers and overall settle-ups between us. An overall
 * settle-up also wrote balancing payments into groups; those were not real
 * money, so they are reversed here to keep the overall total right.
 */
export function outsideBalances(
  meId: Id,
  groups: Group[],
  payments: Payment[],
  transfers: Transfer[],
): Record<Id, Totals> {
  const out: Record<Id, Totals> = {};
  const add = (friend: Id, cur: CurrencyCode, v: number) => {
    out[friend] = out[friend] ?? {};
    out[friend][cur] = (out[friend][cur] ?? 0) + v;
  };
  for (const t of transfers) {
    if (t.from === meId && t.to !== meId) add(t.to, t.currency, t.amount);
    if (t.to === meId && t.from !== meId) add(t.from, t.currency, -t.amount);
  }
  for (const p of payments) {
    if (!p.settlementId) continue;
    const g = groups.find((x) => x.id === p.groupId);
    if (!g) continue;
    if (p.from === meId && p.to !== meId) add(p.to, g.baseCurrency, -p.baseAmount);
    if (p.to === meId && p.from !== meId) add(p.from, g.baseCurrency, p.baseAmount);
  }
  return out;
}

/**
 * My overall balance with each friend: every group plus everything outside
 * groups (positive = they owe me). Groups can use different main currencies,
 * so totals are kept per currency.
 */
export function friendBalances(
  meId: Id,
  groups: Group[],
  expenses: Expense[],
  payments: Payment[],
  transfers: Transfer[] = [],
): Record<Id, Totals> {
  const out: Record<Id, Totals> = {};
  const add = (friend: Id, cur: CurrencyCode, v: number) => {
    out[friend] = out[friend] ?? {};
    out[friend][cur] = (out[friend][cur] ?? 0) + v;
  };
  for (const g of groups) {
    for (const d of groupDebts(g, expenses, payments)) {
      if (d.to === meId) add(d.from, g.baseCurrency, d.amount);
      if (d.from === meId) add(d.to, g.baseCurrency, -d.amount);
    }
  }
  for (const [friend, t] of Object.entries(outsideBalances(meId, groups, payments, transfers))) {
    for (const [c, v] of Object.entries(t)) add(friend, c, v);
  }
  return out;
}

/** My balance with one friend, per group, in each group's main currency. */
export function friendBalanceByGroup(
  meId: Id,
  friendId: Id,
  groups: Group[],
  expenses: Expense[],
  payments: Payment[],
): { group: Group; amount: number }[] {
  const out: { group: Group; amount: number }[] = [];
  for (const g of groups) {
    const amount = pairBalanceInGroup(meId, friendId, g, expenses, payments);
    if (amount !== 0) out.push({ group: g, amount });
  }
  return out;
}

export interface OverallSettlement {
  currency: CurrencyCode;
  /** What the friend owes me overall in this currency (negative: I owe them). */
  total: number;
  /** Each group's balance with the friend before settling. */
  groups: { group: Group; amount: number }[];
  /** Balance outside groups before settling. */
  outside: number;
  /** Payments to write into groups so each one shows as settled. */
  groupPayments: { groupId: Id; from: Id; to: Id; amount: number }[];
}

/**
 * Plan an overall settle-up with a friend in one currency: everything in
 * groups whose main currency it is, plus transfers in that currency.
 * One real payment of |total| clears it all; each group then gets a balancing
 * payment so it shows as settled too.
 */
export function planOverallSettlement(
  meId: Id,
  friendId: Id,
  currency: CurrencyCode,
  groups: Group[],
  expenses: Expense[],
  payments: Payment[],
  transfers: Transfer[],
): OverallSettlement {
  const inCurrency = groups.filter((g) => g.baseCurrency === currency);
  const before = inCurrency
    .map((group) => ({ group, amount: pairBalanceInGroup(meId, friendId, group, expenses, payments) }))
    .filter((x) => x.amount !== 0);
  const outside = outsideBalances(meId, groups, payments, transfers)[friendId]?.[currency] ?? 0;

  // Work out the balancing payments group by group. Simplified groups can
  // re-route a debt after a payment, so repeat until the pair is clear.
  const groupPayments: OverallSettlement['groupPayments'] = [];
  for (const { group } of before) {
    let simulated = payments;
    for (let pass = 0; pass < 6; pass++) {
      const bal = pairBalanceInGroup(meId, friendId, group, expenses, simulated);
      if (bal === 0) break;
      const from = bal > 0 ? friendId : meId;
      const to = bal > 0 ? meId : friendId;
      const amount = Math.abs(bal);
      groupPayments.push({ groupId: group.id, from, to, amount });
      simulated = [
        ...simulated,
        { id: `plan-${group.id}-${pass}`, groupId: group.id, from, to, currency, amount, baseAmount: amount, date: '' },
      ];
    }
  }

  // Merge repeated payments in the same group and direction.
  const merged = new Map<string, OverallSettlement['groupPayments'][number]>();
  for (const p of groupPayments) {
    const k = `${p.groupId}|${p.from}|${p.to}`;
    const m = merged.get(k);
    if (m) m.amount += p.amount;
    else merged.set(k, { ...p });
  }

  return {
    currency,
    total: before.reduce((a, b) => a + b.amount, 0) + outside,
    groups: before,
    outside,
    groupPayments: [...merged.values()],
  };
}

/** Add up per-currency totals. */
export function sumTotals(list: Totals[]): Totals {
  const out: Totals = {};
  for (const t of list) for (const [c, v] of Object.entries(t)) out[c] = (out[c] ?? 0) + v;
  return out;
}

/** Non-zero entries of a per-currency total, largest first. */
export function nonZero(t: Totals): [CurrencyCode, number][] {
  return Object.entries(t)
    .filter(([, v]) => v !== 0)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
}

// ---------------------------------------------------------------------------
// Group summary

export interface MemberSummary {
  id: Id;
  /** What they paid towards expenses (main currency). */
  paid: number;
  /** Their share of the expenses (main currency). */
  share: number;
  /** Settle-up payments they made / received (main currency). */
  sent: number;
  received: number;
  /** paid − share + sent − received: positive means they get money back. */
  balance: number;
}

export interface GroupSummary {
  /** Everything spent, converted to the main currency. */
  total: number;
  /** Spending as it was paid, per currency. */
  byCurrency: Totals;
  expenseCount: number;
  members: MemberSummary[];
}

export function groupSummary(group: Group, expenses: Expense[], payments: Payment[]): GroupSummary {
  const raw = expenses.filter((e) => e.groupId === group.id);
  const l = groupLedger(group, expenses, payments);
  const byCurrency: Totals = {};
  for (const e of raw) byCurrency[e.currency] = (byCurrency[e.currency] ?? 0) + e.amount;

  const ids = new Set<Id>(group.memberIds);
  const m: Record<Id, MemberSummary> = {};
  const get = (id: Id) => {
    ids.add(id);
    return (m[id] = m[id] ?? { id, paid: 0, share: 0, sent: 0, received: 0, balance: 0 });
  };
  group.memberIds.forEach(get);
  for (const e of l.expenses) {
    for (const [id, v] of Object.entries(e.payers)) get(id).paid += v;
    for (const [id, v] of Object.entries(e.shares)) get(id).share += v;
  }
  for (const p of l.payments) {
    get(p.from).sent += p.baseAmount;
    get(p.to).received += p.baseAmount;
  }
  const members = [...ids].map((id) => {
    const x = m[id];
    return { ...x, balance: x.paid - x.share + x.sent - x.received };
  });
  return {
    total: l.expenses.reduce((a, e) => a + e.amount, 0),
    byCurrency,
    expenseCount: raw.length,
    members,
  };
}

// ---------------------------------------------------------------------------
// Removing a friend

/** Whether someone takes part in a group's expenses or payments. */
export function inGroupHistory(groupId: Id, personId: Id, expenses: Expense[], payments: Payment[]): boolean {
  return (
    expenses.some(
      (e) =>
        e.groupId === groupId &&
        (personId in (e.payers ?? {}) || personId in (e.shares ?? {}) || (e.participants ?? []).includes(personId)),
    ) || payments.some((p) => p.groupId === groupId && (p.from === personId || p.to === personId))
  );
}

export type RemoveCheck = { ok: true; leaves: Group[] } | { ok: false; reason: string };

/**
 * Can I remove this friend? Only when we're settled up, they aren't in a group
 * someone else created (shared mode), and they aren't in the expenses or
 * payments of any group we share. If so, `leaves` lists the groups they'll be
 * taken out of. (The database checks the same before removing.)
 */
export function canRemoveFriend(s: AppState, friendId: Id, myUserId: string | null, shared: boolean): RemoveCheck {
  const me = s.meId;
  const friend = s.people[friendId];
  if (!me || !friend || friendId === me) return { ok: false, reason: 'You can’t remove yourself.' };
  const name = friend.name;
  const balance = nonZero(friendBalances(me, s.groups, s.expenses, s.payments, s.transfers)[friendId] ?? {});
  if (balance.length > 0) {
    return { ok: false, reason: `You and ${name} aren’t settled up yet. Settle up first, then you can remove ${name}.` };
  }
  const groups = s.groups.filter((g) => g.memberIds.includes(friendId));
  for (const g of groups) {
    if (shared && g.createdBy !== myUserId) {
      const creator = Object.values(s.people).find((p) => p.userId && p.userId === g.createdBy);
      return {
        ok: false,
        reason: `${name} is in ${g.name}, which ${creator?.name ?? 'someone else'} created. Ask them to take ${name} out of it first.`,
      };
    }
    if (inGroupHistory(g.id, friendId, s.expenses, s.payments)) {
      return { ok: false, reason: `${name} is in the expenses of ${g.name}. To remove ${name}, delete that group first.` };
    }
  }
  return { ok: true, leaves: groups };
}
