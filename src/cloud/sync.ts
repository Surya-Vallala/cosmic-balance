// Translating between the shared database and the app's state.
// Pure functions only, so they can be tested without a network.

import { formatMoney } from '../money';
import type { Activity, AppState, Expense, FriendRequest, Group, Id, JoinRequest, Notice, Payment, Person, Transfer } from '../types';

export interface PersonRow {
  id: string;
  user_id: string | null;
  name: string;
  upi_id: string | null;
  email?: string | null;
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
  /** Null for an expense between friends outside groups. */
  group_id: string | null;
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

export interface NoticeRow {
  id: string;
  kind: string;
  body: string;
  group_id: string | null;
  person_id: string | null;
  created_at: string;
  read_at: string | null;
}
export interface JoinRequestRow {
  id: string;
  group_id: string;
  person_id: string;
  created_at: string;
}

export interface Rows {
  people: PersonRow[];
  groups: GroupRow[];
  expenses: ExpenseRow[];
  payments: PaymentRow[];
  transfers: TransferRow[];
  /** Missing when the database is older than version 4. */
  notifications?: NoticeRow[];
  join_requests?: JoinRequestRow[];
  /** Your friends list (person ids). */
  contacts?: { person_id: string }[];
  friend_requests?: { id: string; from_person: string; to_user: string; created_at: string }[];
}

export function personFromRow(p: PersonRow): Person {
  return { id: p.id, name: p.name, upiId: p.upi_id ?? undefined, userId: p.user_id, email: p.email ?? null };
}

/** Build the app's state from everything the signed-in person can see. */
export function rowsToState(rows: Rows, meId: Id): AppState {
  const people: Record<Id, Person> = {};
  for (const p of rows.people) {
    people[p.id] = personFromRow(p);
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
    // Text a friend typed: only ever shown as text.
    description: typeof r.data.description === 'string' ? r.data.description : '',
    note: typeof r.data.note === 'string' && r.data.note.trim() ? r.data.note : undefined,
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

  const notices: Notice[] = [...(rows.notifications ?? [])]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .map((n) => ({
      id: n.id,
      kind: n.kind,
      body: n.body,
      groupId: n.group_id,
      personId: n.person_id,
      createdAt: n.created_at,
      read: !!n.read_at,
    }));
  // People you see only because they asked to join one of your groups.
  const myUser = people[meId]?.userId;
  const known = new Set<string>([meId, ...(rows.contacts ?? []).map((c) => c.person_id)]);
  for (const g of rows.groups) for (const m of g.member_ids) known.add(m);
  for (const t of rows.transfers) known.add(t.from_person).add(t.to_person);
  for (const p of rows.people) if (myUser && p.created_by === myUser && !p.user_id) known.add(p.id);
  for (const e of rows.expenses) {
    if (!e.group_id) for (const id of [...Object.keys(e.data.payers ?? {}), ...Object.keys(e.data.shares ?? {})]) known.add(id);
  }
  // (and people who asked to be your friend, until you accept)
  const asking = [...(rows.join_requests ?? []).map((r) => r.person_id), ...(rows.friend_requests ?? []).map((r) => r.from_person)];
  for (const id of asking) {
    if (!known.has(id) && people[id]) people[id] = { ...people[id], requesting: true };
  }
  const friendRequests: FriendRequest[] = (rows.friend_requests ?? []).map((r) => ({
    id: r.id,
    fromPerson: r.from_person,
    toUser: r.to_user,
    createdAt: r.created_at,
  }));

  const joinRequests: JoinRequest[] = (rows.join_requests ?? []).map((r) => ({
    id: r.id,
    groupId: r.group_id,
    personId: r.person_id,
    createdAt: r.created_at,
  }));

  const state: AppState = {
    version: 1,
    meId,
    people,
    groups,
    expenses,
    payments,
    transfers,
    activity: [],
    notices,
    joinRequests,
    friendRequests,
  };
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
  // "with you and Priya" for an expense outside groups (leaving out whoever added it).
  const withWhom = (e: Expense, by: string | null) => {
    const adder = by ? byUser.get(by)?.id : undefined;
    const ids = [...new Set([...Object.keys(e.payers ?? {}), ...Object.keys(e.shares ?? {})])].filter((id) => id !== adder);
    const names = ids.sort((a, b) => (a === me ? -1 : b === me ? 1 : 0)).map((id) => name(id, true));
    if (names.length === 0) return 'outside groups';
    return `with ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`}`;
  };

  const out: Activity[] = [];
  for (const g of rows.groups) {
    out.push({ id: `g-${g.id}`, at: g.created_at, groupId: g.id, text: `${actor(g.created_by)} created ${g.name}` });
  }
  for (const e of rows.expenses) {
    const where = e.group_id ? `in ${groupName(e.group_id)}` : withWhom(e.data, e.created_by);
    out.push({
      id: `e-${e.id}`,
      at: e.created_at,
      groupId: e.group_id ?? undefined,
      text: `${actor(e.created_by)} added “${e.data.description}” (${formatMoney(e.data.amount, e.data.currency)}) ${where}`,
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
  | { kind: 'rpc'; fn: string; args: Record<string, unknown> }
  | { table: string; kind: 'insert'; values: Record<string, unknown> | Record<string, unknown>[] }
  | { table: string; kind: 'upsert'; values: Record<string, unknown> }
  | { table: string; kind: 'update'; id: string; values: Record<string, unknown>; failMessage: string }
  | { table: string; kind: 'delete'; id: string; failMessage: string };

/** Minimal shapes of the store's actions that write to the database. */
export type WriteAction =
  | { type: 'savePerson'; person: Person }
  | { type: 'saveGroup'; group: Group }
  | { type: 'deleteGroup'; id: Id }
  | { type: 'leaveGroup'; id: Id }
  | { type: 'saveExpense'; expense: Expense }
  | { type: 'deleteExpense'; id: Id }
  | { type: 'addPayment'; payment: Payment }
  | { type: 'deletePayment'; id: Id }
  | { type: 'saveTransfer'; transfer: Transfer }
  | { type: 'deleteTransfer'; id: Id }
  | { type: 'settleOverall'; settlement: Transfer; payments: Payment[] }
  | { type: 'removeFriend'; id: Id }
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
        simplify_debts: g.simplifyDebts,
        base_currency: g.baseCurrency,
        rates: g.rates,
      };
      const old = before.groups.find((x) => x.id === g.id);
      if (!old) return [{ table: 'groups', kind: 'insert', values: { id: g.id, ...values, member_ids: g.memberIds } }];
      const ops: Op[] = [
        {
          table: 'groups',
          kind: 'update',
          id: g.id,
          values: { ...values, updated_at: new Date().toISOString() },
          failMessage: "Couldn't save the group. You may no longer be a member.",
        },
      ];
      // Members change as additions and removals against the group as it is in
      // the database now, so someone who joined meanwhile isn't dropped.
      const add = g.memberIds.filter((id) => !old.memberIds.includes(id));
      const remove = old.memberIds.filter((id) => !g.memberIds.includes(id));
      if (add.length || remove.length) {
        ops.push({ kind: 'rpc', fn: 'set_group_members', args: { p_group: g.id, p_add: add, p_remove: remove } });
      }
      return ops;
    }
    case 'deleteGroup':
      return [{ table: 'groups', kind: 'delete', id: a.id, failMessage: 'Only the person who created this group can delete it.' }];
    case 'leaveGroup':
      if (!before.meId) return [];
      return [{ kind: 'rpc', fn: 'set_group_members', args: { p_group: a.id, p_add: [], p_remove: [before.meId] } }];
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
    case 'removeFriend':
      return [{ kind: 'rpc', fn: 'remove_friend', args: { p_person: a.id } }];
    default:
      return [];
  }
}
