import { describe, expect, it } from 'vitest';
import type { AppState, Expense, Payment } from '../types';
import { commonCategories, emptyMoney } from './defaults';
import { buildMoneyCsv } from './export';
import { buildEntries } from './logic';
import type { MoneyData } from './types';

function setup(): { m: MoneyData; s: AppState } {
  const m = emptyMoney('INR');
  m.settings.enabled = true;
  m.settings.startedOn = '2026-10-01';
  for (const c of commonCategories()) m.categories[c.id] = c;
  m.accounts = {
    cash: { id: 'cash', name: 'Cash', type: 'cash', currency: 'INR', opening: 0, order: 0, createdAt: '' },
    forex: { id: 'forex', name: 'Forex card', type: 'travel', currency: 'THB', opening: 0, order: 0, createdAt: '' },
  };
  const at = (d: string) => `2026-10-${d}T06:30:00.000Z`;
  m.records = {
    a: { id: 'a', kind: 'expense', amount: 85000, accountId: 'cash', categoryId: 'c-x-car-fuel', note: 'Petrol, "Shell"', date: at('31'), createdAt: '', updatedAt: '' },
    b: { id: 'b', kind: 'income', amount: 10000000, accountId: 'cash', categoryId: 'c-i-salary', details: 'October\nbonus', date: at('30'), createdAt: '', updatedAt: '' },
    c: { id: 'c', kind: 'transfer', amount: 10000000, accountId: 'cash', toAccountId: 'forex', toAmount: 3900000, note: 'Exchange', date: at('29'), createdAt: '', updatedAt: '' },
  };
  const e: Expense = {
    id: 'e1',
    groupId: 'g',
    description: 'Seafood dinner',
    currency: 'THB',
    amount: 260000,
    payers: { anu: 260000 },
    splitType: 'equal',
    participants: ['me', 'anu'],
    inputs: {},
    shares: { me: 52000, anu: 208000 },
    date: at('28'),
    createdAt: at('28'),
  };
  const p: Payment = { id: 'p1', groupId: 'g', from: 'me', to: 'anu', currency: 'INR', amount: 79000, baseAmount: 79000, date: at('27') };
  const s: AppState = {
    version: 1,
    meId: 'me',
    people: { me: { id: 'me', name: 'Surya' }, anu: { id: 'anu', name: 'Anu' } },
    groups: [{ id: 'g', name: 'Thai People', memberIds: ['me', 'anu'], simplifyDebts: true, createdAt: '', baseCurrency: 'INR', rates: { THB: 2.8 } }],
    expenses: [e],
    payments: [p],
    transfers: [],
    activity: [],
  };
  return { m, s };
}

describe('Money as CSV', () => {
  it('lists records, shares and settle-ups newest first, escaped for spreadsheets', () => {
    const { m, s } = setup();
    const csv = buildMoneyCsv(m, buildEntries(m, s), (id) => (id === 'g' ? 'Thai People' : 'No group'));
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Date,Type,Category,Sub-category,Account,To account,Amount,Currency,Note,More details,Group');
    expect(lines[1]).toBe('2026-10-31,Expense,Car,Fuel,Cash,,850,INR,"Petrol, ""Shell""",,');
    expect(lines[2]).toBe('2026-10-30,Income,Salary,,Cash,,100000,INR,,"October');
    expect(lines[3]).toBe('bonus",');
    expect(lines[4]).toBe('2026-10-29,Transfer,,,Cash,Forex card,100000,INR,Exchange · received 39000 THB,,');
    expect(lines[5]).toBe('2026-10-28,Your share (group),Split with friends,,,,520,THB,Seafood dinner,,Thai People');
    expect(lines[6]).toBe('2026-10-27,Settle-up,,,,,-790,INR,You paid Anu back,,Thai People');
    expect(lines).toHaveLength(7);
  });

  it('has just the header with nothing recorded', () => {
    expect(buildMoneyCsv(emptyMoney(), [], () => '')).toBe('Date,Type,Category,Sub-category,Account,To account,Amount,Currency,Note,More details,Group');
  });
});
