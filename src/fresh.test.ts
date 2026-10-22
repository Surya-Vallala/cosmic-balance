import { describe, expect, it } from 'vitest';
import { actionToOps, rowsToState, type Rows } from './cloud/sync';
import {
  acknowledge,
  activityIsNew,
  AWAY_COUNTS_AFTER_MS,
  comeBack,
  fingerprints,
  startVisit,
  whatsNew,
  type Seen,
} from './fresh';
import type { AppState, Expense, Payment, Transfer } from './types';

const ME = '11111111-1111-4111-8111-111111111111';
const RAVI = '22222222-2222-4222-8222-222222222222';
const PRIYA = '44444444-4444-4444-8444-444444444444';
const G = '33333333-3333-4333-8333-333333333333';
const G2 = '55555555-5555-4555-8555-555555555555';

const exp = (id: string, over: Partial<Expense> = {}): Expense => ({
  id,
  groupId: G,
  description: 'Dinner',
  currency: 'INR',
  amount: 90000,
  payers: { [ME]: 90000 },
  splitType: 'equal',
  participants: [ME, RAVI, PRIYA],
  inputs: {},
  shares: { [ME]: 30000, [RAVI]: 30000, [PRIYA]: 30000 },
  date: '2026-10-20T10:00:00.000Z',
  createdAt: '2026-10-20T10:00:00.000Z',
  ...over,
});
const pay = (id: string, over: Partial<Payment> = {}): Payment => ({
  id,
  groupId: G,
  from: RAVI,
  to: ME,
  currency: 'INR',
  amount: 30000,
  baseAmount: 30000,
  date: '2026-10-21T10:00:00.000Z',
  ...over,
});
const tr = (id: string, over: Partial<Transfer> = {}): Transfer => ({
  id,
  kind: 'transfer',
  from: RAVI,
  to: ME,
  currency: 'INR',
  amount: 50000,
  note: 'Cab',
  date: '2026-10-21T10:00:00.000Z',
  createdAt: '2026-10-21T10:00:00.000Z',
  ...over,
});

function state(over: Partial<AppState> = {}): AppState {
  return {
    version: 1,
    meId: ME,
    people: {
      [ME]: { id: ME, name: 'Surya' },
      [RAVI]: { id: RAVI, name: 'Ravi' },
      [PRIYA]: { id: PRIYA, name: 'Priya' },
    },
    groups: [
      { id: G, name: 'Thai People', memberIds: [ME, RAVI, PRIYA], simplifyDebts: true, createdAt: '2026-10-01T00:00:00Z', baseCurrency: 'INR', rates: {} },
    ],
    expenses: [exp('e1'), exp('e2', { description: 'Taxi', amount: 30000, payers: { [RAVI]: 30000 }, shares: { [ME]: 15000, [RAVI]: 15000 } })],
    payments: [pay('p1')],
    transfers: [tr('t1')],
    activity: [],
    ...over,
  };
}

describe('what’s new since the last visit', () => {
  const before = state();
  const seen = fingerprints(before);

  it('nothing, when nothing changed', () => {
    const f = whatsNew(state(), seen);
    expect(f.items.size).toBe(0);
    expect(f.groups.size).toBe(0);
    expect(f.friends.size).toBe(0);
  });

  it('nothing on the very first visit (nothing seen yet)', () => {
    expect(whatsNew(state(), null).items.size).toBe(0);
  });

  it('an expense a friend added: marked, and its group shows one new thing', () => {
    const s = state({ expenses: [...before.expenses, exp('e3', { description: 'Massage' })] });
    const f = whatsNew(s, seen);
    expect([...f.items]).toEqual(['e:e3']);
    expect(f.added.has('e:e3')).toBe(true);
    expect(f.groups.get(G)).toBe(1);
    expect(activityIsNew(f, 'e-e3')).toBe(true);
    expect(activityIsNew(f, 'e-e1')).toBe(false);
  });

  it('an expense a friend edited: marked as changed (not in Activity, which only lists additions)', () => {
    const s = state({ expenses: [exp('e1', { amount: 120000, shares: { [ME]: 40000, [RAVI]: 40000, [PRIYA]: 40000 } }), before.expenses[1]] });
    const f = whatsNew(s, seen);
    expect([...f.items]).toEqual(['e:e1']);
    expect(f.added.size).toBe(0);
    expect(activityIsNew(f, 'e-e1')).toBe(false);
    expect(f.groups.get(G)).toBe(1);
  });

  it('any edit that matters counts: who paid, the date, the remarks', () => {
    for (const over of [{ payers: { [RAVI]: 90000 } }, { date: '2026-10-19T10:00:00.000Z' }, { note: 'With tip' }, { description: 'Lunch' }]) {
      const f = whatsNew(state({ expenses: [exp('e1', over), before.expenses[1]] }), seen);
      expect(f.items.has('e:e1')).toBe(true);
    }
  });

  it('things that don’t matter don’t count: blank remarks, when it was saved, the typed inputs', () => {
    const s = state({ expenses: [exp('e1', { note: '  ', updatedAt: '2026-10-22T00:00:00Z', inputs: { [ME]: '1' } }), before.expenses[1]] });
    expect(whatsNew(s, seen).items.size).toBe(0);
  });

  it('payments in groups and transfers between friends', () => {
    const s = state({ payments: [...before.payments, pay('p2')], transfers: [...before.transfers, tr('t2')] });
    const f = whatsNew(s, seen);
    expect([...f.items].sort()).toEqual(['p:p2', 't:t2']);
    expect(f.groups.get(G)).toBe(1);
    expect(f.friends.get(RAVI)).toBe(1);
    expect(activityIsNew(f, 't-t2')).toBe(true);
  });

  it('expenses outside groups mark the friends in them, and the Outside groups row', () => {
    const s = state({
      expenses: [
        ...before.expenses,
        exp('o1', { groupId: null, participants: [ME, PRIYA], payers: { [PRIYA]: 90000 }, shares: { [ME]: 45000, [PRIYA]: 45000 } }),
      ],
    });
    const f = whatsNew(s, seen);
    expect(f.items.has('e:o1')).toBe(true);
    expect(f.outside).toBe(1);
    expect(f.friends.get(PRIYA)).toBe(1);
    expect(f.friends.has(RAVI)).toBe(false);
    expect(f.groups.size).toBe(0);
  });

  it('a group you were added to: the group is marked, not every expense in it', () => {
    const s = state({
      groups: [...before.groups, { ...before.groups[0], id: G2, name: 'Goa' }],
      expenses: [...before.expenses, exp('g2a', { groupId: G2 }), exp('g2b', { groupId: G2 })],
      payments: [...before.payments, pay('g2p', { groupId: G2 })],
    });
    const f = whatsNew(s, seen);
    expect(f.newGroups.has(G2)).toBe(true);
    expect(f.groups.get(G2)).toBe(0);
    expect(f.items.size).toBe(0);
    expect(activityIsNew(f, `g-${G2}`)).toBe(true);
    expect(activityIsNew(f, `g-${G}`)).toBe(false);
  });

  it('deleted things: nothing to mark', () => {
    const f = whatsNew(state({ expenses: [before.expenses[0]], payments: [], transfers: [] }), seen);
    expect(f.items.size).toBe(0);
  });

  it('your own changes are never marked', () => {
    const after = state({
      expenses: [exp('e1', { amount: 99000, shares: { [ME]: 33000, [RAVI]: 33000, [PRIYA]: 33000 } }), exp('mine', { description: 'Snacks' })],
      transfers: [],
    });
    const mine = acknowledge(seen, before, after);
    expect(whatsNew(after, mine).items.size).toBe(0);
    // …while a friend's change that arrived earlier stays marked.
    const withFriend = state({ payments: [...before.payments, pay('p9')] });
    const afterMine = { ...withFriend, expenses: [...withFriend.expenses, exp('mine2')] };
    const f = whatsNew(afterMine, acknowledge(seen, withFriend, afterMine));
    expect([...f.items]).toEqual(['p:p9']);
  });

  it('a friend’s placeholder merged into their account (only the ids change): not new', () => {
    const NEW_RAVI = '66666666-6666-4666-8666-666666666666';
    const swap = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k === RAVI ? NEW_RAVI : k, v]));
    const people = { ...before.people, [NEW_RAVI]: { id: NEW_RAVI, name: 'Ravi Kumar' } } as AppState['people'];
    delete people[RAVI];
    const s = state({
      people,
      expenses: before.expenses.map((e) => ({ ...e, payers: swap(e.payers), shares: swap(e.shares), participants: e.participants.map((id) => (id === RAVI ? NEW_RAVI : id)) })),
      payments: [pay('p1', { from: NEW_RAVI })],
      transfers: [tr('t1', { from: NEW_RAVI })],
    });
    expect(whatsNew(s, seen).items.size).toBe(0);
    // A real change at the same time still counts.
    const s2 = { ...s, expenses: [{ ...s.expenses[0], amount: 1 }, s.expenses[1]] };
    expect([...whatsNew(s2, seen).items]).toEqual(['e:e1']);
  });

  it('who paid changing (same amounts, nobody merged) still counts', () => {
    const s = state({ expenses: [before.expenses[0], { ...before.expenses[1], payers: { [ME]: 30000 } }] });
    expect([...whatsNew(s, seen).items]).toEqual(['e:e2']);
  });
});

// The database stores the data as jsonb, which reorders keys. A round trip must
// not make anything look new.
function jsonbOrder(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(jsonbOrder);
  if (v && typeof v === 'object') {
    const keys = Object.keys(v).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(keys.filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => [k, jsonbOrder((v as Record<string, unknown>)[k])]));
  }
  return v;
}

describe('a change you make looks the same after it comes back from the server', () => {
  it('expenses, payments and transfers', () => {
    const s = state({
      expenses: [
        exp('e1', { note: 'With tip', updatedAt: '2026-10-20T10:00:00.000Z' }),
        exp('o1', { groupId: null, note: '' }),
      ],
      transfers: [tr('t1'), tr('t2', { kind: 'settlement', note: undefined })],
      payments: [pay('p1'), pay('p2', { settlementId: 't2' })],
    });
    // What the app sends for each.
    const sent = [
      ...s.expenses.map((e) => actionToOps({ type: 'saveExpense', expense: e }, s)[0]),
      ...s.transfers.map((t) => actionToOps({ type: 'saveTransfer', transfer: t }, s)[0]),
      ...s.payments.map((p) => actionToOps({ type: 'addPayment', payment: p }, s)[0]),
    ] as { table: string; values: Record<string, unknown> }[];
    const back = (table: string) =>
      sent
        .filter((o) => o.table === table)
        .map((o) => {
          const v = JSON.parse(JSON.stringify(o.values));
          return { ...v, data: jsonbOrder(v.data), created_by: null, created_at: '2026-10-22T06:00:00.123456+00:00', updated_at: '2026-10-22T06:00:01.5+00:00' };
        });
    const rows: Rows = {
      people: Object.values(s.people).map((p) => ({ id: p.id, user_id: null, name: p.name, upi_id: null, created_by: null, created_at: '2026-10-01T00:00:00Z' })),
      groups: [{ id: G, name: 'Thai People', member_ids: [ME, RAVI, PRIYA], simplify_debts: true, base_currency: 'INR', rates: {}, invite_code: 'x', created_by: null, created_at: '2026-10-01T00:00:00Z' }],
      expenses: back('expenses'),
      payments: back('payments'),
      transfers: back('transfers'),
    };
    const fromServer = rowsToState(rows, ME);
    expect(whatsNew(fromServer, fingerprints(s)).items.size).toBe(0);
    expect(fingerprints(fromServer)).toEqual(fingerprints(s));
  });
});

describe('visits', () => {
  const a: Seen = { 'e:1': 'a' };
  const b: Seen = { 'e:1': 'b' };
  it('opening the app afresh starts from what was on screen when it was last put away', () => {
    expect(startVisit({ base: a, left: b })).toEqual({ base: b, left: null });
    expect(startVisit({ base: a, left: null })).toEqual({ base: a, left: null });
    expect(startVisit(null)).toEqual({ base: null, left: null });
  });
  it('coming back after a while: a new visit; after a quick look elsewhere: the same one', () => {
    expect(comeBack({ base: a, left: b }, AWAY_COUNTS_AFTER_MS)).toEqual({ base: b, left: null });
    expect(comeBack({ base: a, left: b }, 5000)).toEqual({ base: a, left: null });
  });
});
