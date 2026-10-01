import { describe, expect, it } from 'vitest';
import type { AppState, Expense, Payment, Transfer } from '../types';
import { actionToOps, rowsToState, type Rows } from './sync';

const ME = '11111111-1111-4111-8111-111111111111';
const RAVI = '22222222-2222-4222-8222-222222222222';
const G = '33333333-3333-4333-8333-333333333333';
const U_ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const expense: Expense = {
  id: 'e1',
  groupId: G,
  description: 'Hostel',
  currency: 'THB',
  amount: 600000,
  payers: { [ME]: 600000 },
  splitType: 'equal',
  participants: [ME, RAVI],
  inputs: {},
  shares: { [ME]: 300000, [RAVI]: 300000 },
  date: '2026-10-01T10:00:00Z',
  createdAt: '2026-10-01T10:00:00Z',
};

const rows: Rows = {
  people: [
    { id: ME, user_id: U_ME, name: 'Surya', upi_id: 'surya@okicici', email: 'surya@gmail.com', created_by: U_ME, created_at: '2026-10-01T09:00:00Z' },
    { id: RAVI, user_id: null, name: 'Ravi', upi_id: null, email: 'ravi@gmail.com', created_by: U_ME, created_at: '2026-10-01T09:01:00Z' },
  ],
  groups: [
    {
      id: G,
      name: 'Thailand trip',
      member_ids: [ME, RAVI],
      simplify_debts: true,
      base_currency: 'INR',
      rates: { THB: 2.87 },
      invite_code: 'abc123',
      created_by: U_ME,
      created_at: '2026-10-01T09:02:00Z',
    },
  ],
  expenses: [{ id: 'e1', group_id: G, data: expense, created_by: U_ME, created_at: '2026-10-01T10:00:00Z' }],
  payments: [],
  transfers: [
    {
      id: 't1',
      from_person: ME,
      to_person: RAVI,
      data: { id: 't1', kind: 'transfer', from: ME, to: RAVI, currency: 'INR', amount: 15000, note: 'Cash', date: '2026-10-01T11:00:00Z', createdAt: '2026-10-01T11:00:00Z' },
      created_by: U_ME,
      created_at: '2026-10-01T11:00:00Z',
    },
  ],
};

describe('rowsToState', () => {
  const s = rowsToState(rows, ME);

  it('maps people, marking who has an account', () => {
    expect(s.meId).toBe(ME);
    expect(s.people[ME]).toEqual({ id: ME, name: 'Surya', upiId: 'surya@okicici', userId: U_ME, email: 'surya@gmail.com' });
    expect(s.people[RAVI].email).toBe('ravi@gmail.com');
    expect(s.people[RAVI].userId).toBeNull();
  });

  it('maps groups with invite code, creator and currencies', () => {
    expect(s.groups[0]).toMatchObject({
      id: G,
      memberIds: [ME, RAVI],
      baseCurrency: 'INR',
      rates: { THB: 2.87 },
      inviteCode: 'abc123',
      createdBy: U_ME,
    });
  });

  it('takes expenses and transfers from their stored data', () => {
    expect(s.expenses[0]).toEqual(expense);
    expect(s.transfers[0]).toMatchObject({ id: 't1', from: ME, to: RAVI, amount: 15000 });
  });

  it('writes the activity feed from my point of view, newest first', () => {
    expect(s.activity.map((a) => a.text)).toEqual([
      'You gave Ravi ₹150 (Cash)',
      'You added “Hostel” (฿6,000) in Thailand trip',
      'You created Thailand trip',
    ]);
  });

  it('shows another member their own point of view', () => {
    const forRavi = rowsToState(
      { ...rows, people: rows.people.map((p) => (p.id === RAVI ? { ...p, user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } : p)) },
      RAVI,
    );
    expect(forRavi.activity[0].text).toBe('Surya gave you ₹150 (Cash)');
    expect(forRavi.activity[1].text).toBe('Surya added “Hostel” (฿6,000) in Thailand trip');
  });
});

describe('actionToOps', () => {
  const before: AppState = rowsToState(rows, ME);

  it('inserts a new friend and updates an existing one', () => {
    expect(actionToOps({ type: 'savePerson', person: { id: 'new', name: 'Priya' } }, before)).toEqual([
      { table: 'people', kind: 'insert', values: { id: 'new', name: 'Priya', upi_id: null } },
    ]);
    const [op] = actionToOps({ type: 'savePerson', person: { id: RAVI, name: 'Ravi K', upiId: 'r@ybl' } }, before);
    expect(op).toMatchObject({ table: 'people', kind: 'update', id: RAVI, values: { name: 'Ravi K', upi_id: 'r@ybl' } });
  });

  it('inserts new groups and updates only editable columns of existing ones', () => {
    const g = { ...before.groups[0], name: 'Thailand 2026' };
    const ops = actionToOps({ type: 'saveGroup', group: g }, before);
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('update');
    expect(Object.keys((ops[0] as { values: object }).values).sort()).toEqual(
      ['base_currency', 'name', 'rates', 'simplify_debts', 'updated_at'].sort(),
    );
    const [ins] = actionToOps({ type: 'saveGroup', group: { ...g, id: 'g2' } }, before);
    expect(ins).toMatchObject({ table: 'groups', kind: 'insert', values: { id: 'g2', name: 'Thailand 2026', member_ids: [ME, RAVI] } });
    expect((ins as { values: Record<string, unknown> }).values.invite_code).toBeUndefined();
  });

  it('changes members as additions and removals, never by overwriting the list', () => {
    const PRIYA = '44444444-4444-4444-8444-444444444444';
    const g = { ...before.groups[0], memberIds: [ME, PRIYA] };
    const ops = actionToOps({ type: 'saveGroup', group: g }, before);
    expect(ops.map((o) => o.kind)).toEqual(['update', 'rpc']);
    expect(ops[1]).toEqual({ kind: 'rpc', fn: 'set_group_members', args: { p_group: G, p_add: [PRIYA], p_remove: [RAVI] } });
  });

  it('leaves a group by removing yourself', () => {
    expect(actionToOps({ type: 'leaveGroup', id: G }, before)).toEqual([
      { kind: 'rpc', fn: 'set_group_members', args: { p_group: G, p_add: [], p_remove: [ME] } },
    ]);
  });

  it('upserts expenses and deletes by id', () => {
    const [op] = actionToOps({ type: 'saveExpense', expense }, before);
    expect(op).toMatchObject({ table: 'expenses', kind: 'upsert', values: { id: 'e1', group_id: G, data: expense } });
    expect(actionToOps({ type: 'deleteExpense', id: 'e1' }, before)[0]).toMatchObject({ table: 'expenses', kind: 'delete', id: 'e1' });
  });

  it('writes an overall settle-up before the group payments that depend on it', () => {
    const settlement: Transfer = { id: 's1', kind: 'settlement', from: RAVI, to: ME, currency: 'INR', amount: 100, date: '', createdAt: '' };
    const payment: Payment = { id: 'p1', groupId: G, from: RAVI, to: ME, currency: 'INR', amount: 100, baseAmount: 100, date: '', settlementId: 's1' };
    const ops = actionToOps({ type: 'settleOverall', settlement, payments: [payment] }, before);
    expect(ops.map((o) => ('table' in o ? o.table : o.fn))).toEqual(['transfers', 'payments']);
    expect(ops[0]).toMatchObject({ kind: 'insert', values: { id: 's1', from_person: RAVI, to_person: ME } });
    expect(ops[1]).toMatchObject({ kind: 'insert', values: [{ id: 'p1', group_id: G, settlement_id: 's1' }] });
  });

  it('ignores actions that only exist on the phone', () => {
    expect(actionToOps({ type: 'loadSample' }, before)).toEqual([]);
    expect(actionToOps({ type: 'reset' }, before)).toEqual([]);
  });
});
