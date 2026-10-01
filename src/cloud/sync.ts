// Translating between the shared database and the app's state.
// Pure functions only, so they can be tested without a network.

import { formatMoney } from '../money';
import type { Activity, AppState, Expense, Group, Id, Payment, Person, Transfer } from '../types';

export interface PersonRow {
  id: string;
  user_id: string | null;
  name: string;
  upi_id: string | null;
  created_by: string | null;
  created_at: string;
}
export interface GroupRow {
  id: string;
  name: string;
  member_ids: string[];
  simplify_debts: boolean;
  base_currency: string;
  rates: Record<string, number> | null;
  invite_code: string;
  created_by: string | null;
  created_at: string;
  updated_at?: string;
}
export interface ExpenseRow {
  id: string;
  group_id: string;
  data: Expense;
  created_by: string | null;
  created_at: string;
  updated_at?: string;
}
export interface PaymentRow {
  id: string;
  group_id: string;
  settlement_id: string | null;
  data: Payment;
  created_by: string | null;
  created_at: string;
}
export interface TransferRow {
  id: string;
  from_person: string;
  to_person: string;
  data: Transfer;
  created_by: string | null;
  created_at: string;
}

export interface Rows {
  people: PersonRow[];
  groups: GroupRow[];
  expenses: ExpenseRow[];
  payments: PaymentRow[];
  transfers: TransferRow[];
}

/** Build the app's state from everything the signed-in person can see. */
export function rowsToState(rows: Rows, meId: Id): AppState {
  const people: Record<Id, Person> = {};
  for (const p of rows.people) {
    people[p.id] = { id: p.id, name: p.name, upiId: p.upi_id ?? undefined, userId: p.user_id };
  }
  const groups: Group[] = [...rows.groups]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .map((g) => ({
      id: g.id,
      name: g.name,
      memberIds: g.member_ids,
      simplifyDebts: g.simplify_debts,
      createdAt: g.created_at,
      baseCurrency: g.base_currency,
      rates: g.rates ?? {},
      inviteCode: g.invite_code,
      createdBy: g.created_by,
    }));
  const expenses: Expense[] = rows.expenses.map((r) => ({
    ...r.data,
    id: r.id,
    groupId: r.group_id,
    currency: r.data.currency ?? 'INR',
    date: r.data.date ?? r.created_at,
    createdAt: r.data.createdAt ?? r.created_at,
  }));
  const payments: Payment[] = rows.payments.map((r) => ({
    ...r.data,
    id: r.id,
    groupId: r.group_id,
    settlementId: r.settlement_id ?? undefined,
    date: r.data.date ?? r.created_at,
    baseAmount: r.data.baseAmount ?? r.data.amount,
  }));
  const transfers: Transfer[] = rows.transfers.map((r) => ({
    ...r.data,
    id: r.id,
    from: r.from_person,
    to: r.to_person,
    date: r.data.date ?? r.created_at,
    createdAt: r.data.createdAt ?? r.created_at,
  }));

  const state: AppState = { version: 1, meId, people, groups, expenses, payments, transfers, activity: [] };
  state.activity = deriveActivity(rows, state);
  return state;
}

/**
 * The activity feed in shared mode is worked out from the data itself, so
 * everyone sees it from their own point of view ("You paid Ravi…").
 */
export function deriveActivity(rows: Rows, s: AppState): Activity[] {
  const me = s.meId;
  const byUser = new Map<string, Person>();
  for (const p of Object.values(s.people)) if (p.userId) byUser.set(p.userId, p);
  const actor = (uid: string | null) => {
    const p = uid ? byUser.get(uid) : undefined;
    if (!p) return 'Someone';
    return p.id === me ? 'You' : p.name;
  };
  const name = (id: Id, object = false) => (id === me ? (object ? 'you' : 'You') : s.people[id]?.name ?? 'Someone');
  const groupName = (id: Id) => rows.groups.find((g) => g.id === id)?.name ?? 'a group';

  const out: Activity[] = [];
  for (const g of rows.groups) {
    out.push({ id: `g-${g.id}`, at: g.created_at, groupId: g.id, text: `${actor(g.created_by)} created ${g.name}` });
  }
  for (const e of rows.expenses) {
    out.push({
      id: `e-${e.id}`,
      at: e.created_at,
      groupId: e.group_id,
      text: `${actor(e.created_by)} added “${e.data.description}” (${formatMoney(e.data.amount, e.data.currency)}) in ${groupName(e.group_id)}`,
    });
  }
  for (const p of rows.payments) {
    if (p.settlement_id) continue; // shown once, with its overall settle-up
    out.push({
      id: `p-${p.id}`,
      at: p.created_at,
      groupId: p.group_id,
      text: `${name(p.data.from)} paid ${name(p.data.to, true)} ${formatMoney(p.data.amount, p.data.currency)} in ${groupName(p.group_id)}`,
    });
  }
  for (const t of rows.transfers) {
    const amount = formatMoney(t.data.amount, t.data.currency);
    const text =
      t.data.kind === 'settlement'
        ? `${name(t.from_person)} settled up with ${name(t.to_person, true)}: ${amount}`
        : `${name(t.from_person)} gave ${name(t.to_person, true)} ${amount}${t.data.note ? ` (${t.data.note})` : ''}`;
    out.push({ id: `t-${t.id}`, at: t.created_at, text });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 200);
}

// ---------------------------------------------------------------------------
// Writes

export type Op =
  | { table: string; kind: 'insert'; values: Record<string, unknown> | Record<string, unknown>[] }
  | { table: string; kind: 'upsert'; values: Record<string, unknown> }
  | { table: string; kind: 'update'; id: string; values: Record<string, unknown>; failMessage: string }
  | { table: string; kind: 'delete'; id: string; failMessage: string };

/** Minimal shapes of the store's actions that write to the database. */
export type WriteAction =
  | { type: 'savePerson'; person: Person }
  | { type: 'saveGroup'; group: Group }
  | { type: 'deleteGroup'; id: Id }
  | { type: 'saveExpense'; expense: Expense }
  | { type: 'deleteExpense'; id: Id }
  | { type: 'addPayment'; payment: Payment }
  | { type: 'deletePayment'; id: Id }
  | { type: 'saveTransfer'; transfer: Transfer }
  | { type: 'deleteTransfer'; id: Id }
  | { type: 'settleOverall'; settlement: Transfer; payments: Payment[] }
  | { type: string };

const paymentRow = (p: Payment) => ({ id: p.id, group_id: p.groupId, settlement_id: p.settlementId ?? null, data: p });
const transferRow = (t: Transfer) => ({ id: t.id, from_person: t.from, to_person: t.to, data: t });

/** What to write to the database for one action, given the state before it. */
export function actionToOps(action: WriteAction, before: AppState): Op[] {
  const a = action as Extract<WriteAction, { type: typeof action.type }> & Record<string, any>;
  switch (action.type) {
    case 'savePerson': {
      const p: Person = a.person;
      if (before.people[p.id]) {
        return [
          {
            table: 'people',
            kind: 'update',
            id: p.id,
            values: { name: p.name, upi_id: p.upiId ?? null },
            failMessage: `${p.name} manages their own name and UPI ID.`,
          },
        ];
      }
      return [{ table: 'people', kind: 'insert', values: { id: p.id, name: p.name, upi_id: p.upiId ?? null } }];
    }
    case 'saveGroup': {
      const g: Group = a.group;
      const values = {
        name: g.name,
        member_ids: g.memberIds,
        simplify_debts: g.simplifyDebts,
        base_currency: g.baseCurrency,
        rates: g.rates,
      };
      if (before.groups.some((x) => x.id === g.id)) {
        return [
          {
            table: 'groups',
            kind: 'update',
            id: g.id,
            values: { ...values, updated_at: new Date().toISOString() },
            failMessage: "Couldn't save the group. You may no longer be a member.",
          },
        ];
      }
      return [{ table: 'groups', kind: 'insert', values: { id: g.id, ...values } }];
    }
    case 'deleteGroup':
      return [{ table: 'groups', kind: 'delete', id: a.id, failMessage: 'Only the person who created this group can delete it.' }];
    case 'saveExpense': {
      const e: Expense = a.expense;
      return [{ table: 'expenses', kind: 'upsert', values: { id: e.id, group_id: e.groupId, data: e, updated_at: new Date().toISOString() } }];
    }
    case 'deleteExpense':
      return [{ table: 'expenses', kind: 'delete', id: a.id, failMessage: "Couldn't delete the expense." }];
    case 'addPayment':
      return [{ table: 'payments', kind: 'insert', values: paymentRow(a.payment) }];
    case 'deletePayment':
      return [{ table: 'payments', kind: 'delete', id: a.id, failMessage: "Couldn't delete the payment." }];
    case 'saveTransfer':
      return [{ table: 'transfers', kind: 'upsert', values: transferRow(a.transfer) }];
    case 'deleteTransfer':
      return [{ table: 'transfers', kind: 'delete', id: a.id, failMessage: "Couldn't delete the transfer." }];
    case 'settleOverall': {
      const ops: Op[] = [{ table: 'transfers', kind: 'insert', values: transferRow(a.settlement) }];
      if (a.payments.length) ops.push({ table: 'payments', kind: 'insert', values: a.payments.map(paymentRow) });
      return ops;
    }
    default:
      return [];
  }
}
