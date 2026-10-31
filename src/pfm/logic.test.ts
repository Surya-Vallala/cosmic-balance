import { describe, expect, it } from 'vitest';
import type { AppState, Expense, Group, Payment, Transfer } from '../types';
import { commonCategories, emptyMoney } from './defaults';
import {
  accountBalances,
  accountTotals,
  addMonths,
  buildEntries,
  byCategory,
  byDay,
  calendarWeeks,
  categoryPath,
  changeIn,
  convert,
  describeFilter,
  dueDays,
  freeze,
  fromSplit,
  matches,
  monthLabel,
  monthOf,
  monthRange,
  NO_CATEGORY,
  NO_FILTER,
  nextDue,
  noteSuggestions,
  nthDay,
  OUTSIDE,
  OWN,
  passes,
  recordFor,
  SPLIT_CATEGORY,
  suggestedAccount,
  sums,
  toMain,
  topOf,
  yearRange,
} from './logic';
import type { Account, MoneyData, MoneyRecord, Repeat } from './types';

const ME = 'me';
const RAVI = 'ravi';
const ANU = 'anu';

function money(): MoneyData {
  const m = emptyMoney('INR');
  m.settings.enabled = true;
  m.settings.startedOn = '2026-10-01';
  m.settings.rates = { THB: 2.5 };
  for (const c of commonCategories()) m.categories[c.id] = c;
  const acc = (id: string, type: Account['type'], opening: number, currency = 'INR'): Account => ({
    id,
    name: id.toUpperCase(),
    type,
    currency,
    opening,
    order: 0,
    createdAt: '2026-10-01T00:00:00.000Z',
  });
  m.accounts = {
    cash: acc('cash', 'cash', 500000),
    hdfc: acc('hdfc', 'bank', 10000000),
    card: acc('card', 'card', -200000),
    forex: acc('forex', 'travel', 0, 'THB'),
  };
  return m;
}

const rec = (id: string, kind: MoneyRecord['kind'], amount: number, accountId: string, date: string, extra: Partial<MoneyRecord> = {}): MoneyRecord => ({
  id,
  kind,
  amount,
  accountId,
  date,
  createdAt: date,
  updatedAt: date,
  ...extra,
});

const thai: Group = {
  id: 'thai',
  name: 'Thai People',
  memberIds: [ME, RAVI, ANU],
  simplifyDebts: true,
  createdAt: '2026-09-01T00:00:00.000Z',
  baseCurrency: 'INR',
  rates: { THB: 2.8 },
};

const expense = (id: string, date: string, amount: number, payers: Record<string, number>, shares: Record<string, number>, currency = 'INR', groupId: string | null = 'thai'): Expense => ({
  id,
  groupId,
  description: `Expense ${id}`,
  currency,
  amount,
  payers,
  splitType: 'exact',
  participants: Object.keys(shares),
  inputs: {},
  shares,
  date,
  createdAt: date,
});

function state(expenses: Expense[] = [], payments: Payment[] = [], transfers: Transfer[] = []): AppState {
  return {
    version: 1,
    meId: ME,
    people: { [ME]: { id: ME, name: 'Surya' }, [RAVI]: { id: RAVI, name: 'Ravi' }, [ANU]: { id: ANU, name: 'Anu' } },
    groups: [thai],
    expenses,
    payments,
    transfers,
    activity: [],
  };
}

describe('months', () => {
  it('starts months on the 1st by default', () => {
    expect(monthOf('2026-10-31')).toEqual({ y: 2026, m: 9 });
    expect(monthRange({ y: 2026, m: 9 })).toEqual({ from: '2026-10-01', to: '2026-11-01' });
    expect(monthRange({ y: 2026, m: 11 })).toEqual({ from: '2026-12-01', to: '2027-01-01' });
    expect(monthLabel({ y: 2026, m: 9 })).toBe('Oct 2026');
  });
  it('lets a month start on the 25th (salary day)', () => {
    expect(monthOf('2026-10-24', 25)).toEqual({ y: 2026, m: 8 });
    expect(monthOf('2026-10-25', 25)).toEqual({ y: 2026, m: 9 });
    expect(monthRange({ y: 2026, m: 9 }, 25)).toEqual({ from: '2026-10-25', to: '2026-11-25' });
    expect(monthLabel({ y: 2026, m: 9 }, 25)).toBe('25 Oct – 24 Nov');
    expect(yearRange(2026, 25)).toEqual({ from: '2026-01-25', to: '2027-01-25' });
  });
  it('steps across years', () => {
    expect(addMonths({ y: 2026, m: 0 }, -1)).toEqual({ y: 2025, m: 11 });
    expect(addMonths({ y: 2026, m: 11 }, 13)).toEqual({ y: 2028, m: 0 });
  });
  it('lays out a calendar month in weeks', () => {
    // October 2026 starts on a Thursday.
    const mon = calendarWeeks({ y: 2026, m: 9 }, 1);
    expect(mon[0]).toEqual([null, null, null, '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(mon.flat().filter(Boolean)).toHaveLength(31);
    const sun = calendarWeeks({ y: 2026, m: 9 }, 0);
    expect(sun[0].slice(0, 5)).toEqual([null, null, null, null, '2026-10-01']);
    expect(mon.every((w) => w.length === 7)).toBe(true);
  });
});

describe('currencies', () => {
  it('converts with your rates, or the group rate when the group uses your main currency', () => {
    const m = money();
    expect(toMain(m.settings, 10000, 'THB')).toBe(25000);
    expect(toMain(m.settings, 10000, 'THB', thai)).toBe(28000);
    expect(convert(m.settings, 25000, 'INR', 'THB')).toBe(10000);
    expect(convert(m.settings, 10000, 'THB', 'THB')).toBe(10000);
  });
});

describe('categories', () => {
  it('names sub-categories with their parent', () => {
    const m = money();
    expect(categoryPath(m.categories, 'c-x-car-fuel')).toEqual(['Car', 'Fuel']);
    expect(topOf(m.categories, 'c-x-car-fuel')).toBe('c-x-car');
    expect(topOf(m.categories, 'c-x-food')).toBe('c-x-food');
    expect(categoryPath(m.categories, SPLIT_CATEGORY)).toEqual(['Split with friends']);
    expect(topOf(m.categories, undefined)).toBe(NO_CATEGORY);
  });
});

describe('account balances', () => {
  it('adds what you record to the opening balance', () => {
    const m = money();
    m.records = {
      a: rec('a', 'expense', 85000, 'cash', '2026-10-31T09:00:00.000Z', { categoryId: 'c-x-car-fuel' }),
      b: rec('b', 'income', 10000000, 'hdfc', '2026-10-30T09:00:00.000Z', { categoryId: 'c-i-salary' }),
      c: rec('c', 'expense', 122700, 'card', '2026-10-30T09:00:00.000Z'),
      d: rec('d', 'transfer', 10000000, 'cash', '2026-10-30T10:00:00.000Z', { toAccountId: 'forex', toAmount: 3900000 }),
    };
    const bal = accountBalances(m, state());
    expect(bal.cash).toBe(500000 - 85000 - 10000000);
    expect(bal.hdfc).toBe(20000000);
    expect(bal.card).toBe(-322700);
    expect(bal.forex).toBe(3900000);
  });

  it('counts split items you said an account paid or received, in its currency', () => {
    const m = money();
    const e1 = expense('e1', '2026-10-20T10:00:00.000Z', 360000, { [ME]: 360000 }, { [ME]: 120000, [RAVI]: 120000, [ANU]: 120000 });
    const e2 = expense('e2', '2026-10-21T10:00:00.000Z', 630000, { [ME]: 630000 }, { [ME]: 210000, [RAVI]: 420000 }, 'THB');
    const e3 = expense('e3', '2026-10-22T10:00:00.000Z', 100000, { [ME]: 100000 }, { [RAVI]: 100000 }, 'THB');
    const p1: Payment = { id: 'p1', groupId: 'thai', from: RAVI, to: ME, currency: 'INR', amount: 500000, baseAmount: 500000, date: '2026-10-29T10:00:00.000Z' };
    const p2: Payment = { id: 'p2', groupId: 'thai', from: ME, to: ANU, currency: 'INR', amount: 7900, baseAmount: 7900, date: '2026-10-29T10:00:00.000Z' };
    m.links = {
      'e:e1': { id: 'e:e1', accountId: 'hdfc', at: '' },
      'e:e2': { id: 'e:e2', accountId: 'forex', at: '' }, // same currency
      'e:e3': { id: 'e:e3', accountId: 'card', amount: 290000, at: '' }, // what the card was charged
      'p:p1': { id: 'p:p1', accountId: 'hdfc', at: '' },
      'p:p2': { id: 'p:p2', accountId: null, at: '' }, // not tracked
    };
    const bal = accountBalances(m, state([e1, e2, e3], [p1, p2]));
    expect(bal.hdfc).toBe(10000000 - 360000 + 500000);
    expect(bal.forex).toBe(-630000);
    expect(bal.card).toBe(-200000 - 290000);
    expect(bal.cash).toBe(500000);
  });

  it('converts a split item paid from an account in another currency', () => {
    const m = money();
    const e = expense('e', '2026-10-20T10:00:00.000Z', 100000, { [ME]: 100000 }, { [ME]: 50000, [RAVI]: 50000 }, 'THB');
    m.links = { 'e:e': { id: 'e:e', accountId: 'hdfc', at: '' } };
    // THB at the group's rate (2.8), the group uses INR like Money.
    expect(accountBalances(m, state([e])).hdfc).toBe(10000000 - 280000);
  });

  it('forgets a deleted expense', () => {
    const m = money();
    m.links = { 'e:gone': { id: 'e:gone', accountId: 'hdfc', at: '' } };
    expect(accountBalances(m, state()).hdfc).toBe(10000000);
  });

  it('totals assets and what you owe in the main currency', () => {
    const m = money();
    const bal = { cash: 500000, hdfc: 1000000, card: -200000, forex: 1000000 };
    expect(accountTotals(m, bal)).toEqual({ assets: 500000 + 1000000 + 2500000, liabilities: 200000 });
  });
});

describe('the list', () => {
  it('shows your share of group expenses from the day Money was turned on', () => {
    const m = money();
    m.settings.groupCategory = { thai: 'c-x-travel' };
    const before = expense('old', '2026-09-30T10:00:00.000Z', 300000, { [RAVI]: 300000 }, { [ME]: 100000, [RAVI]: 200000 });
    const shared = expense('dinner', '2026-10-31T10:00:00.000Z', 260000, { [ANU]: 260000 }, { [ME]: 52000, [ANU]: 208000 }, 'THB');
    const list = buildEntries(m, state([before, shared]));
    expect(list.map((e) => e.key)).toEqual(['e:dinner']);
    const e = list[0];
    expect(e.kind).toBe('share');
    expect(e.amount).toBe(52000);
    expect(e.currency).toBe('THB');
    expect(e.expense).toBe(Math.round(52000 * 2.8));
    expect(e.categoryId).toBe('c-x-travel');
    expect(e.info).toBe('Your share · Anu paid ฿2,600');
    expect(e.sortOut).toBe(false); // nothing of yours moved
  });

  it('counts only your share when you pay for everyone, and asks which account paid', () => {
    const m = money();
    const rent = expense('rent', '2026-10-29T10:00:00.000Z', 3600000, { [ME]: 3600000 }, { [ME]: 1200000, [RAVI]: 1200000, [ANU]: 1200000 });
    const [e] = buildEntries(m, state([rent]));
    expect(e.expense).toBe(1200000);
    expect(e.categoryId).toBe(SPLIT_CATEGORY);
    expect(e.sortOut).toBe(true);
    expect(e.moved).toBe(-3600000);
    expect(e.info).toBe('Your share · you paid ₹36,000');
    m.links = { 'e:rent': { id: 'e:rent', accountId: 'hdfc', categoryId: 'c-x-home-rent', at: '' } };
    const [linked] = buildEntries(m, state([rent]));
    expect(linked.sortOut).toBe(false);
    expect(linked.categoryId).toBe('c-x-home-rent');
    expect(linked.info).toBe('Your share · you paid ₹36,000 from HDFC');
  });

  it("doesn't ask for groups you chose not to track", () => {
    const m = money();
    m.settings.usual = { thai: null };
    const e = expense('x', '2026-10-29T10:00:00.000Z', 1000, { [ME]: 1000 }, { [ME]: 500, [RAVI]: 500 });
    expect(buildEntries(m, state([e]))[0].sortOut).toBe(false);
  });

  it("doesn't ask when there are no accounts yet", () => {
    const m = money();
    m.accounts = {};
    const e = expense('x', '2026-10-29T10:00:00.000Z', 1000, { [ME]: 1000 }, { [ME]: 500, [RAVI]: 500 });
    expect(buildEntries(m, state([e]))[0].sortOut).toBe(false);
  });

  it('shows paying for friends without counting it as spending', () => {
    const m = money();
    const e = expense('x', '2026-10-29T10:00:00.000Z', 100000, { [ME]: 100000 }, { [RAVI]: 100000 });
    const [entry] = buildEntries(m, state([e]));
    expect(entry.kind).toBe('paid');
    expect(entry.expense).toBe(0);
    expect(entry.info).toBe('You paid for friends');
  });

  it('shows settle-ups as neither income nor spending, and skips the balancing payments of an overall settle-up', () => {
    const m = money();
    const p1: Payment = { id: 'p1', groupId: 'thai', from: RAVI, to: ME, currency: 'INR', amount: 300000, baseAmount: 300000, date: '2026-10-30T10:00:00.000Z' };
    const p2: Payment = { id: 'p2', groupId: 'thai', from: RAVI, to: ANU, currency: 'INR', amount: 100, baseAmount: 100, date: '2026-10-30T10:00:00.000Z' };
    const p3: Payment = { ...p1, id: 'p3', settlementId: 's1' };
    const t1: Transfer = { id: 't1', kind: 'transfer', from: ME, to: RAVI, currency: 'INR', amount: 1000000, date: '2026-10-28T10:00:00.000Z', createdAt: '', note: 'Loan' };
    const s1: Transfer = { id: 's1', kind: 'settlement', from: ANU, to: ME, currency: 'INR', amount: 5000, date: '2026-10-27T10:00:00.000Z', createdAt: '' };
    m.links = { 'p:p1': { id: 'p:p1', accountId: 'hdfc', at: '' } };
    const list = buildEntries(m, state([], [p1, p2, p3], [t1, s1]));
    expect(list.map((e) => e.key)).toEqual(['p:p1', 't:t1', 't:s1']);
    expect(list.map((e) => e.title)).toEqual(['Ravi paid you back', 'You gave Ravi', 'Anu settled up with you']);
    expect(list[0].info).toBe('Thai People → HDFC');
    expect(list[0].sortOut).toBe(false);
    expect(list[1].sortOut).toBe(true);
    expect(list[1].info).toBe('Between friends');
    expect(sums(list)).toEqual({ income: 0, expense: 0, net: 0, count: 3 });
  });

  it('adds up days and totals', () => {
    const m = money();
    m.records = {
      a: rec('a', 'expense', 85000, 'cash', '2026-10-31T09:00:00.000Z', { categoryId: 'c-x-car-fuel', note: 'Petrol, Shell' }),
      b: rec('b', 'income', 10000000, 'hdfc', '2026-10-30T09:00:00.000Z', { categoryId: 'c-i-salary' }),
      c: rec('c', 'expense', 60000, 'cash', '2026-10-30T08:00:00.000Z', { categoryId: 'c-x-home-maintenance', note: 'Plumber' }),
      d: rec('d', 'transfer', 1000, 'cash', '2026-10-30T07:00:00.000Z', { toAccountId: 'hdfc' }),
    };
    const list = buildEntries(m, state());
    const days = byDay(list);
    expect(days.map((d) => [d.day, d.income, d.expense, d.entries.length])).toEqual([
      ['2026-10-31', 0, 85000, 1],
      ['2026-10-30', 10000000, 60000, 3],
    ]);
    expect(sums(list)).toEqual({ income: 10000000, expense: 145000, net: 10000000 - 145000, count: 4 });
  });

  it('finds entries by note, category, account, group or people', () => {
    const m = money();
    m.records = { a: rec('a', 'expense', 85000, 'cash', '2026-10-31T09:00:00.000Z', { categoryId: 'c-x-car-fuel', note: 'Petrol, Shell Jubilee Hills' }) };
    const e = expense('d', '2026-10-31T10:00:00.000Z', 260000, { [ANU]: 260000 }, { [ME]: 52000, [ANU]: 208000 }, 'THB');
    const list = buildEntries(m, state([e]));
    const find = (q: string) => list.filter((x) => matches(x, q)).map((x) => x.key);
    expect(find('petrol')).toEqual(['r:a']);
    expect(find('fuel')).toEqual(['r:a']);
    expect(find('jubilee petrol')).toEqual(['r:a']);
    expect(find('cash')).toEqual(['r:a']);
    expect(find('thai')).toEqual(['e:d']);
    expect(find('anu')).toEqual(['e:d']);
    expect(find('petrol thai')).toEqual([]);
  });
});

describe('filters', () => {
  const m = money();
  m.records = {
    fuel: rec('fuel', 'expense', 85000, 'cash', '2026-10-31T09:00:00.000Z', { categoryId: 'c-x-car-fuel' }),
    emi: rec('emi', 'expense', 3150000, 'hdfc', '2026-10-11T09:00:00.000Z', { categoryId: 'c-x-car' }),
    food: rec('food', 'expense', 10000, 'card', '2026-10-12T09:00:00.000Z', { categoryId: 'c-x-food' }),
    pay: rec('pay', 'income', 100, 'hdfc', '2026-10-12T09:00:00.000Z', { categoryId: 'c-i-salary' }),
    move: rec('move', 'transfer', 100, 'hdfc', '2026-10-12T09:00:00.000Z', { toAccountId: 'cash' }),
  };
  const share = expense('s', '2026-10-17T10:00:00.000Z', 240000, { [ME]: 240000 }, { [ME]: 120000, [RAVI]: 120000 });
  m.links = { 'e:s': { id: 'e:s', accountId: 'hdfc', categoryId: 'c-x-car-fuel', at: '' } };
  const p: Payment = { id: 'p', groupId: 'thai', from: RAVI, to: ME, currency: 'INR', amount: 100, baseAmount: 100, date: '2026-10-20T10:00:00.000Z' };
  const list = buildEntries(m, state([share], [p]));
  const keys = (f: typeof NO_FILTER) => list.filter((e) => passes(e, f, m.categories)).map((e) => e.key).sort();

  it('shows everything with no filter', () => {
    expect(keys(NO_FILTER)).toHaveLength(7);
  });
  it('picks spending by category, a top category including its sub-categories', () => {
    expect(keys({ ...NO_FILTER, expense: ['c-x-car'] })).toEqual(['e:s', 'r:emi', 'r:fuel']);
    expect(keys({ ...NO_FILTER, expense: ['c-x-car-fuel'] })).toEqual(['e:s', 'r:fuel']);
    expect(keys({ ...NO_FILTER, income: ['c-i-salary'] })).toEqual(['r:pay']);
  });
  it('narrows to your own records or a group', () => {
    expect(keys({ ...NO_FILTER, expense: ['c-x-car'], groups: [OWN] })).toEqual(['r:emi', 'r:fuel']);
    expect(keys({ ...NO_FILTER, groups: ['thai'] })).toEqual(['e:s', 'p:p']);
    expect(keys({ ...NO_FILTER, groups: [OUTSIDE] })).toEqual([]);
  });
  it('narrows to accounts', () => {
    expect(keys({ ...NO_FILTER, accounts: ['cash'] })).toEqual(['r:fuel', 'r:move']);
    expect(keys({ ...NO_FILTER, accounts: ['hdfc'], expense: ['c-x-car'] })).toEqual(['e:s', 'r:emi']);
  });
  it('describes itself', () => {
    expect(describeFilter({ ...NO_FILTER, expense: ['c-x-car-fuel', 'c-x-car-maintenance'] }, m, () => '')).toBe('Car: Fuel, Maintenance');
    expect(describeFilter({ ...NO_FILTER, expense: ['c-x-car'], groups: ['thai', OWN] }, m, () => 'Thai People')).toBe('Car · Thai People, My own');
  });
});

describe('stats', () => {
  it('adds spending up by top category, with your shares in groups', () => {
    const m = money();
    m.records = {
      fuel: rec('fuel', 'expense', 85000, 'cash', '2026-10-31T09:00:00.000Z', { categoryId: 'c-x-car-fuel' }),
      emi: rec('emi', 'expense', 3150000, 'hdfc', '2026-10-11T09:00:00.000Z', { categoryId: 'c-x-car' }),
      food: rec('food', 'expense', 10000, 'card', '2026-10-12T09:00:00.000Z', { categoryId: 'c-x-food' }),
    };
    m.settings.groupCategory = { thai: 'c-x-food' };
    const e = expense('d', '2026-10-31T10:00:00.000Z', 30000, { [ANU]: 30000 }, { [ME]: 10000, [ANU]: 20000 });
    const stats = byCategory(buildEntries(m, state([e])), m.categories);
    expect(stats.map((c) => [c.name, c.total])).toEqual([
      ['Car', 3235000],
      ['Food', 20000],
    ]);
    expect(stats[0].subs).toEqual([{ id: 'c-x-car-fuel', name: 'Fuel', total: 85000 }]);
    expect(stats[1].shares).toEqual([['thai', 10000]]);
  });
});

describe('repeats', () => {
  it('lands monthly repeats on the same date, or the month end', () => {
    expect(nthDay('2026-01-31', 'month', 1)).toBe('2026-02-28');
    expect(nthDay('2026-01-31', 'month', 2)).toBe('2026-03-31');
    expect(nthDay('2026-10-28', 'week', 1)).toBe('2026-11-04');
    expect(nthDay('2024-02-29', 'year', 1)).toBe('2025-02-28');
    expect(nthDay('2026-12-31', 'day', 1)).toBe('2027-01-01');
  });
  it('makes what is due since the last one, and no more', () => {
    const r: Repeat = { id: 'rent', every: 'month', start: '2026-08-05', lastMade: null, template: { kind: 'expense', amount: 1, accountId: 'hdfc' } };
    expect(dueDays(r, '2026-10-31')).toEqual(['2026-08-05', '2026-09-05', '2026-10-05']);
    expect(dueDays({ ...r, lastMade: '2026-09-05' }, '2026-10-31')).toEqual(['2026-10-05']);
    expect(dueDays({ ...r, lastMade: '2026-10-05' }, '2026-10-31')).toEqual([]);
    expect(dueDays({ ...r, until: '2026-09-30' }, '2026-10-31')).toEqual(['2026-08-05', '2026-09-05']);
    expect(nextDue({ ...r, lastMade: '2026-10-05' }, '2026-10-31')).toBe('2026-11-05');
    expect(nextDue({ ...r, until: '2026-10-31' }, '2026-10-31')).toBeNull();
    const made = recordFor(r, '2026-10-05', 'now');
    expect(made.id).toBe('rent-2026-10-05');
    expect(made.repeatId).toBe('rent');
    expect(made.date.slice(0, 10)).toMatch(/2026-10-0[45]/);
  });
});

describe('helpers', () => {
  it('suggests notes you used before, in the same category first', () => {
    const m = money();
    m.records = {
      a: rec('a', 'expense', 1, 'cash', '2026-10-01T09:00:00.000Z', { note: 'Petrol, Shell', categoryId: 'c-x-car-fuel' }),
      b: rec('b', 'expense', 1, 'cash', '2026-10-05T09:00:00.000Z', { note: 'Petrol and car wash', categoryId: 'c-x-car' }),
      c: rec('c', 'expense', 1, 'cash', '2026-10-06T09:00:00.000Z', { note: 'Pet food' }),
    };
    expect(noteSuggestions(m, 'pet', 'c-x-car-fuel')).toEqual(['Petrol, Shell', 'Pet food', 'Petrol and car wash']);
    expect(noteSuggestions(m, 'ash', null)).toEqual([]);
    expect(noteSuggestions(m, 'wash', null)).toEqual(['Petrol and car wash']);
    expect(noteSuggestions(m, 'car', null)).toEqual(['Petrol and car wash']);
  });

  it('suggests the usual account for a group', () => {
    const m = money();
    expect(suggestedAccount(m, 'thai')).toBe('cash');
    expect(suggestedAccount(m, 'thai', 'THB')).toBe('forex');
    m.settings.usual = { thai: 'hdfc', outside: null };
    expect(suggestedAccount(m, 'thai', 'THB')).toBe('hdfc');
    expect(suggestedAccount(m, null)).toBeNull();
  });

  it("reads Split's balances as money owed to you and by you", () => {
    const m = money();
    const e = expense('x', '2026-10-01T10:00:00.000Z', 300000, { [ME]: 300000 }, { [ME]: 100000, [RAVI]: 100000, [ANU]: 100000 });
    const e2 = expense('y', '2026-10-01T10:00:00.000Z', 100000, { [RAVI]: 100000 }, { [ME]: 100000 }, 'INR', null);
    expect(fromSplit(m, state([e, e2]))).toEqual({ owedToYou: 100000, youOwe: 0 });
  });
});

describe('changes in one account', () => {
  it('matches the account balances, entry by entry', async () => {
    const { changeIn } = await import('./logic');
    const m = money();
    m.records = {
      a: rec('a', 'expense', 85000, 'cash', '2026-10-31T09:00:00.000Z'),
      b: rec('b', 'income', 10000000, 'hdfc', '2026-10-30T09:00:00.000Z'),
      d: rec('d', 'transfer', 1000000, 'hdfc', '2026-10-30T10:00:00.000Z', { toAccountId: 'forex', toAmount: 390000 }),
    };
    const e1 = expense('e1', '2026-10-20T10:00:00.000Z', 360000, { [ME]: 360000 }, { [ME]: 120000, [RAVI]: 240000 });
    const e2 = expense('e2', '2026-10-21T10:00:00.000Z', 100000, { [ME]: 100000 }, { [ME]: 50000, [RAVI]: 50000 }, 'THB');
    const e3 = expense('e3', '2026-10-22T10:00:00.000Z', 100000, { [ME]: 100000 }, { [RAVI]: 100000 }, 'THB');
    const p1: Payment = { id: 'p1', groupId: 'thai', from: RAVI, to: ME, currency: 'INR', amount: 500000, baseAmount: 500000, date: '2026-10-29T10:00:00.000Z' };
    m.links = {
      'e:e1': { id: 'e:e1', accountId: 'hdfc', at: '' },
      'e:e2': { id: 'e:e2', accountId: 'hdfc', at: '' },
      'e:e3': { id: 'e:e3', accountId: 'card', amount: 290000, at: '' },
      'p:p1': { id: 'p:p1', accountId: 'hdfc', at: '' },
    };
    const s = state([e1, e2, e3], [p1]);
    const list = buildEntries(m, s);
    const bal = accountBalances(m, s);
    for (const id of Object.keys(m.accounts)) {
      const sum = list.reduce((a, e) => a + changeIn(m, s, e, id), 0);
      expect(m.accounts[id].opening + sum).toBe(bal[id]);
    }
    const byKey = (k: string) => list.find((e) => e.key === k)!;
    expect(changeIn(m, s, byKey('r:d'), 'hdfc')).toBe(-1000000);
    expect(changeIn(m, s, byKey('r:d'), 'forex')).toBe(390000);
    expect(changeIn(m, s, byKey('e:e2'), 'hdfc')).toBe(-280000);
    expect(changeIn(m, s, byKey('e:e3'), 'card')).toBe(-290000);
    expect(changeIn(m, s, byKey('p:p1'), 'hdfc')).toBe(500000);
    expect(changeIn(m, s, byKey('p:p1'), 'cash')).toBe(0);
  });
});

describe('leaving a group keeps what Money counted', () => {
  it('keeps your share and the money that moved, as they were', () => {
    const m = money();
    m.settings.groupCategory = { thai: 'c-x-travel' };
    const hotel = expense('hotel', '2026-10-20T10:00:00.000Z', 3000000, { [ME]: 3000000 }, { [ME]: 750000, [RAVI]: 1500000, [ANU]: 750000 });
    const back: Payment = { id: 'back', groupId: 'thai', from: RAVI, to: ME, currency: 'INR', amount: 1500000, baseAmount: 1500000, date: '2026-10-25T10:00:00.000Z' };
    m.links = { 'e:hotel': { id: 'e:hotel', accountId: 'hdfc', at: '' }, 'p:back': { id: 'p:back', accountId: 'hdfc', at: '' } };
    const s = state([hotel], [back]);
    const before = buildEntries(m, s);
    const balBefore = accountBalances(m, s).hdfc;
    for (const e of before) {
      const f = freeze(m, s, e);
      expect(f).not.toBeNull();
      m.links[e.key] = { ...(m.links[e.key] ?? { id: e.key, accountId: null, at: '' }), frozen: f! };
    }
    // Leaving: the group, its expenses and payments are gone from Split.
    const gone = { ...s, groups: [], expenses: [], payments: [] };
    const after = buildEntries(m, gone);
    expect(after.map((e) => e.key)).toEqual(before.map((e) => e.key));
    expect(sums(after)).toEqual(sums(before));
    expect(after[1].categoryId).toBe('c-x-travel');
    expect(after.every((e) => e.groupLabel === 'Thai People' && e.kept)).toBe(true);
    expect(accountBalances(m, gone).hdfc).toBe(balBefore);
    expect(changeIn(m, gone, after[0], 'hdfc')).toBe(1500000);
    // While the group is still there (leaving didn't go through), Split's own copy counts, once.
    expect(accountBalances(m, s).hdfc).toBe(balBefore);
    expect(buildEntries(m, s)).toHaveLength(before.length);
  });
});
