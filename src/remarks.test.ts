import { describe, expect, it, vi } from 'vitest';
import { actionToOps, rowsToState, type ExpenseRow, type Rows } from './cloud/sync';
import { buildCsv } from './export';
import type { AppState, Expense } from './types';

// vitest hoists this above the imports.
vi.mock('react-native', () => ({ Platform: { OS: 'web' }, Share: { share: vi.fn() } }));

const me = 'p-me';
const ravi = 'p-ravi';

function expense(extra: Partial<Expense> = {}): Expense {
  return {
    id: 'e1',
    groupId: null,
    description: 'Dinner',
    currency: 'INR',
    amount: 100000,
    payers: { [me]: 100000 },
    splitType: 'equal',
    participants: [me, ravi],
    inputs: {},
    shares: { [me]: 50000, [ravi]: 50000 },
    date: '2026-10-04T12:00:00.000Z',
    createdAt: '2026-10-04T12:00:00.000Z',
    ...extra,
  };
}

function rows(data: Record<string, unknown>): Rows {
  const row: ExpenseRow = {
    id: 'e1',
    group_id: null,
    data: data as unknown as Expense,
    created_by: null,
    created_at: '2026-10-04T12:00:00.000Z',
  };
  return {
    people: [
      { id: me, name: 'Surya', upi_id: null, user_id: 'u1', email: null },
      { id: ravi, name: 'Ravi', upi_id: null, user_id: 'u2', email: null },
    ] as unknown as Rows['people'],
    groups: [],
    expenses: [row],
    payments: [],
    transfers: [],
  };
}

describe('expense remarks', () => {
  it('are saved with the expense', () => {
    const e = expense({ note: 'Ravi’s birthday, he didn’t pay' });
    const [op] = actionToOps({ type: 'saveExpense', expense: e }, {} as AppState);
    expect(op).toMatchObject({ table: 'expenses', kind: 'upsert' });
    expect((op as unknown as { values: { data: Expense } }).values.data.note).toBe('Ravi’s birthday, he didn’t pay');
  });

  it('come back when loaded', () => {
    const s = rowsToState(rows({ ...expense({ note: 'Paid at the counter' }) }), me);
    expect(s.expenses[0].note).toBe('Paid at the counter');
  });

  it('are left out when empty or not text', () => {
    expect(rowsToState(rows({ ...expense(), note: '   ' }), me).expenses[0].note).toBeUndefined();
    expect(rowsToState(rows({ ...expense(), note: { evil: true } }), me).expenses[0].note).toBeUndefined();
    expect(rowsToState(rows({ ...expense(), description: 42 }), me).expenses[0].description).toBe('');
    expect(rowsToState(rows({ ...expense() }), me).expenses[0].note).toBeUndefined();
  });

  it('fill the Note column of the export', () => {
    const state = {
      meId: me,
      people: { [me]: { id: me, name: 'Surya' }, [ravi]: { id: ravi, name: 'Ravi' } },
      groups: [],
      expenses: [expense({ note: 'Cab, then "snacks"\non the way' })],
      payments: [],
      transfers: [],
    } as unknown as AppState;
    const csv = buildCsv(state);
    expect(csv.split('\n')[0].endsWith(',Note')).toBe(true);
    expect(csv).toContain('"Cab, then ""snacks""\non the way"');
  });
});
