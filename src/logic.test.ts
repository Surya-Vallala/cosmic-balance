import { describe, expect, it } from 'vitest';
import {
  allocate,
  outsideBalances,
  pairBalanceInGroup,
  planOverallSettlement,
  convertExpense,
  fromBase,
  groupDebts,
  groupSummary,
  toBase,
  computePayers,
  computeSplit,
  expenseOwes,
  friendBalances,
  netBalances,
  pairwiseDebts,
  simplifyDebts,
  canRemoveFriend,
} from './logic';
import { approxRate, formatMoney, formatRupees, parseRupees } from './money';
import type { AppState, Expense, Group, Payment, Transfer } from './types';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function exp(
  id: string,
  amount: number,
  paidBy: string | Record<string, number>,
  shares: Record<string, number>,
  groupId = 'g',
): Expense {
  return {
    id,
    groupId,
    description: id,
    amount,
    currency: 'INR',
    payers: typeof paidBy === 'string' ? { [paidBy]: amount } : paidBy,
    splitType: 'exact',
    participants: Object.keys(shares),
    inputs: {},
    shares,
    date: '2026-10-01',
    createdAt: '2026-10-01',
  };
}

describe('money', () => {
  it('formats in Indian grouping', () => {
    expect(formatRupees(12345678)).toBe('₹1,23,456.78');
    expect(formatRupees(45000)).toBe('₹450');
    expect(formatRupees(5)).toBe('₹0.05');
    expect(formatRupees(-150050, { sign: true })).toBe('−₹1,500.50');
  });
  it('parses rupees to paise', () => {
    expect(parseRupees('450')).toBe(45000);
    expect(parseRupees('1,250.5')).toBe(125050);
    expect(parseRupees('₹ 0.07')).toBe(7);
    expect(parseRupees('12.345')).toBeNull();
    expect(parseRupees('abc')).toBeNull();
  });
});

describe('allocate', () => {
  it('always sums to total', () => {
    for (const total of [1, 100, 10001, 99999]) {
      for (const n of [1, 2, 3, 7]) {
        const parts = allocate(total, Array(n).fill(1));
        expect(sum(parts)).toBe(total);
        expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
      }
    }
  });
  it('splits proportionally', () => {
    expect(allocate(1000, [1, 2, 2])).toEqual([200, 400, 400]);
  });
});

describe('computeSplit', () => {
  it('equal split of ₹100 three ways', () => {
    const r = computeSplit(10000, 'equal', ['a', 'b', 'c'], {});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(sum(Object.values(r.shares))).toBe(10000);
      expect(r.shares).toEqual({ a: 3334, b: 3333, c: 3333 });
    }
  });
  it('exact split must add up', () => {
    const bad = computeSplit(10000, 'exact', ['a', 'b'], { a: '60', b: '30' });
    expect(bad).toEqual({ ok: false, error: '₹10 still to assign.' });
    const good = computeSplit(10000, 'exact', ['a', 'b'], { a: '60', b: '40' });
    expect(good).toEqual({ ok: true, shares: { a: 6000, b: 4000 } });
  });
  it('percent split must total 100', () => {
    expect(computeSplit(10000, 'percent', ['a', 'b'], { a: '50', b: '40' }).ok).toBe(false);
    const r = computeSplit(10000, 'percent', ['a', 'b', 'c'], { a: '33.33', b: '33.33', c: '33.34' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(sum(Object.values(r.shares))).toBe(10000);
  });
  it('shares split', () => {
    const r = computeSplit(90000, 'shares', ['a', 'b'], { a: '2', b: '1' });
    expect(r).toEqual({ ok: true, shares: { a: 60000, b: 30000 } });
  });
  it('drops people with zero share', () => {
    const r = computeSplit(10000, 'shares', ['a', 'b'], { a: '1', b: '' });
    expect(r).toEqual({ ok: true, shares: { a: 10000 } });
  });
  it('rejects zero amount and empty participants', () => {
    expect(computeSplit(0, 'equal', ['a'], {}).ok).toBe(false);
    expect(computeSplit(100, 'equal', [], {}).ok).toBe(false);
  });
});

describe('balances', () => {
  // a pays 300 for a,b,c; b pays 150 for b,c
  const expenses = [
    exp('e1', 30000, 'a', { a: 10000, b: 10000, c: 10000 }),
    exp('e2', 15000, 'b', { b: 7500, c: 7500 }),
  ];

  it('net balances sum to zero', () => {
    const net = netBalances(expenses, []);
    expect(net).toEqual({ a: 20000, b: -2500, c: -17500 });
    expect(sum(Object.values(net))).toBe(0);
  });

  it('simplified debts settle everyone', () => {
    const net = netBalances(expenses, []);
    const debts = simplifyDebts(net);
    expect(debts).toEqual([
      { from: 'c', to: 'a', amount: 17500 },
      { from: 'b', to: 'a', amount: 2500 },
    ]);
    // applying debts as payments zeroes all balances
    const payments: Payment[] = debts.map((d, i) => ({
      id: 'p' + i,
      groupId: 'g',
      ...d,
      currency: 'INR',
      baseAmount: d.amount,
      date: '',
    }));
    const after = netBalances(expenses, payments);
    expect(Object.values(after).every((v) => v === 0)).toBe(true);
  });

  it('pairwise debts keep who-paid-for-whom', () => {
    const debts = pairwiseDebts(expenses, []);
    expect(debts).toEqual(
      expect.arrayContaining([
        { from: 'c', to: 'a', amount: 10000 },
        { from: 'b', to: 'a', amount: 10000 },
        { from: 'c', to: 'b', amount: 7500 },
      ]),
    );
    expect(debts).toHaveLength(3);
  });

  it('payments reduce debts, overpaying flips direction', () => {
    const pay: Payment[] = [
      { id: 'p', groupId: 'g', from: 'b', to: 'a', amount: 12000, currency: 'INR', baseAmount: 12000, date: '' },
    ];
    const debts = pairwiseDebts([exp('e1', 30000, 'a', { a: 10000, b: 10000, c: 10000 })], pay);
    expect(debts).toEqual(
      expect.arrayContaining([
        { from: 'c', to: 'a', amount: 10000 },
        { from: 'a', to: 'b', amount: 2000 },
      ]),
    );
  });

  it('simplification removes chains', () => {
    // a owes b 100, b owes c 100 -> a pays c directly
    const ex = [exp('x', 10000, 'b', { a: 10000 }), exp('y', 10000, 'c', { b: 10000 })];
    expect(simplifyDebts(netBalances(ex, []))).toEqual([{ from: 'a', to: 'c', amount: 10000 }]);
  });

  it('friend balances across groups', () => {
    const base = { baseCurrency: 'INR', rates: {}, createdAt: '' };
    const g1: Group = { id: 'g1', name: 'Trip', memberIds: ['a', 'b'], simplifyDebts: true, ...base };
    const g2: Group = { id: 'g2', name: 'Flat', memberIds: ['a', 'b'], simplifyDebts: false, ...base };
    const ex = [
      exp('t', 20000, 'a', { a: 10000, b: 10000 }, 'g1'),
      exp('f', 6000, 'b', { a: 3000, b: 3000 }, 'g2'),
    ];
    expect(friendBalances('a', [g1, g2], ex, [])).toEqual({ b: { INR: 7000 } });
  });
});

describe('multiple payers', () => {
  // ₹900 dinner for a, b, c (₹300 each). a paid ₹600, b paid ₹300.
  const dinner = exp('d', 90000, { a: 60000, b: 30000 }, { a: 30000, b: 30000, c: 30000 });

  it('net balances credit each payer with what they paid', () => {
    expect(netBalances([dinner], [])).toEqual({ a: 30000, b: 0, c: -30000 });
  });

  it('shares are owed to payers in proportion to what they paid', () => {
    // c's ₹300 goes 2:1 to a and b; b's ₹300 also goes 2:1 (₹100 to self).
    const owes = expenseOwes(dinner);
    const total = (from: string, to: string) =>
      owes.filter((d) => d.from === from && d.to === to).reduce((x, d) => x + d.amount, 0);
    expect(total('c', 'a') + total('c', 'b')).toBe(30000);
    expect(total('c', 'a')).toBe(20000);
    expect(total('b', 'a')).toBe(20000);
    expect(total('a', 'b')).toBe(10000);
  });

  it('pairwise debts net out to the same balances', () => {
    const debts = pairwiseDebts([dinner], []);
    const net: Record<string, number> = {};
    for (const d of debts) {
      net[d.from] = (net[d.from] ?? 0) - d.amount;
      net[d.to] = (net[d.to] ?? 0) + d.amount;
    }
    expect(net.a ?? 0).toBe(30000);
    expect(net.b ?? 0).toBe(0);
    expect(net.c ?? 0).toBe(-30000);
  });

  it('every payer gets back exactly what they paid, even with odd paise', () => {
    // ₹100.01 paid 3 ways, split 7 ways
    const parts = allocate(10001, Array(7).fill(1));
    const shares = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id, i) => [id, parts[i]]));
    const e = exp('odd', 10001, { a: 3334, b: 3333, c: 3334 }, shares);
    const owes = expenseOwes(e);
    for (const payer of ['a', 'b', 'c']) {
      const received = owes.filter((d) => d.to === payer).reduce((x, d) => x + d.amount, 0);
      const net = received - owes.filter((d) => d.from === payer).reduce((x, d) => x + d.amount, 0);
      expect(net).toBe(e.payers[payer] - e.shares[payer]);
    }
  });

  it('validates what each person paid', () => {
    expect(computePayers(90000, ['a', 'b'], { a: '600', b: '300' })).toEqual({
      ok: true,
      payers: { a: 60000, b: 30000 },
    });
    expect(computePayers(90000, ['a', 'b'], { a: '600' })).toEqual({
      ok: false,
      error: "₹300 of the total isn't paid by anyone yet.",
    });
    expect(computePayers(90000, ['a', 'b'], { a: '600', b: '400' })).toEqual({
      ok: false,
      error: 'Payments add up to ₹100 more than the total.',
    });
    expect(computePayers(90000, ['a', 'b'], {}).ok).toBe(false);
  });
});

describe('currencies', () => {
  const thai: Group = {
    id: 't',
    name: 'Thailand',
    memberIds: ['a', 'b', 'c'],
    simplifyDebts: true,
    createdAt: '',
    baseCurrency: 'INR',
    rates: { THB: 2.87 },
  };
  const inThb = (id: string, amount: number, paidBy: string, shares: Record<string, number>): Expense => ({
    ...exp(id, amount, paidBy, shares, 't'),
    currency: 'THB',
  });

  it('formats each currency with its own symbol and grouping', () => {
    expect(formatMoney(123456700, 'INR')).toBe('₹12,34,567');
    expect(formatMoney(123456700, 'THB')).toBe('฿1,234,567');
    expect(formatMoney(120050, 'AED')).toBe('AED 1,200.50');
    expect(formatMoney(150049, 'JPY')).toBe('¥1,500');
    expect(formatMoney(-2500, 'USD', { sign: true })).toBe('−$25');
  });

  it('suggests rates between any two currencies', () => {
    expect(approxRate('THB', 'INR')).toBe(2.87);
    expect(approxRate('INR', 'INR')).toBe(1);
    expect(approxRate('USD', 'THB')).toBeCloseTo(96 / 2.87, 1);
  });

  it('converts to and from the main currency', () => {
    expect(toBase(thai, 100000, 'THB')).toBe(287000); // ฿1,000 = ₹2,870
    expect(fromBase(thai, 287000, 'THB')).toBe(100000);
    expect(toBase(thai, 5000, 'INR')).toBe(5000);
  });

  it('converted expenses still add up exactly', () => {
    const e = inThb('x', 100001, 'a', { a: 33334, b: 33334, c: 33333 });
    const c = convertExpense(thai, e);
    expect(c.currency).toBe('INR');
    expect(c.amount).toBe(287003);
    expect(sum(Object.values(c.shares))).toBe(c.amount);
    expect(sum(Object.values(c.payers))).toBe(c.amount);
  });

  it('mixes rupee and baht expenses into one set of balances', () => {
    const ex = [
      exp('flights', 3000000, 'a', { a: 1000000, b: 1000000, c: 1000000 }, 't'), // ₹30,000
      inThb('hostel', 600000, 'b', { a: 200000, b: 200000, c: 200000 }), // ฿6,000
    ];
    // a: +20,000 − ₹5,740 = +14,260; b: −10,000 + ₹11,480 = +1,480; c: −15,740
    const debts = groupDebts(thai, ex, []);
    expect(debts).toEqual([
      { from: 'c', to: 'a', amount: 1426000 },
      { from: 'c', to: 'b', amount: 148000 },
    ]);
  });

  it('a payment in baht settles a rupee balance', () => {
    const ex = [inThb('dinner', 100000, 'a', { a: 50000, b: 50000 })]; // b owes ฿500 = ₹1,435
    const pay: Payment[] = [
      { id: 'p', groupId: 't', from: 'b', to: 'a', currency: 'THB', amount: 50000, baseAmount: 143500, date: '' },
    ];
    expect(groupDebts(thai, ex, [])).toEqual([{ from: 'b', to: 'a', amount: 143500 }]);
    expect(groupDebts(thai, ex, pay)).toEqual([]);
  });
});

describe('group summary', () => {
  const g: Group = {
    id: 'g',
    name: 'Trip',
    memberIds: ['a', 'b', 'c'],
    simplifyDebts: true,
    createdAt: '',
    baseCurrency: 'INR',
    rates: { THB: 2.5 },
  };
  const ex: Expense[] = [
    exp('e1', 30000, 'a', { a: 10000, b: 10000, c: 10000 }),
    { ...exp('e2', 20000, { b: 10000, c: 10000 }, { a: 10000, b: 10000 }), currency: 'THB' },
  ];
  const pay: Payment[] = [
    { id: 'p', groupId: 'g', from: 'c', to: 'a', currency: 'INR', amount: 5000, baseAmount: 5000, date: '' },
  ];

  it('totals spending per currency and in the main currency', () => {
    const s = groupSummary(g, ex, pay);
    expect(s.byCurrency).toEqual({ INR: 30000, THB: 20000 });
    expect(s.total).toBe(30000 + 50000);
    expect(s.expenseCount).toBe(2);
  });

  it('shows what each person paid, their share, and their balance', () => {
    const s = groupSummary(g, ex, pay);
    const by = Object.fromEntries(s.members.map((m) => [m.id, m]));
    expect(by.a).toMatchObject({ paid: 30000, share: 35000, received: 5000, balance: -10000 });
    expect(by.b).toMatchObject({ paid: 25000, share: 35000, balance: -10000 });
    expect(by.c).toMatchObject({ paid: 25000, share: 10000, sent: 5000, balance: 20000 });
    expect(sum(s.members.map((m) => m.balance))).toBe(0);
  });
});

describe('transfers and overall settle-up', () => {
  const g = (id: string, members: string[], simplify = true): Group => ({
    id,
    name: id,
    memberIds: members,
    simplifyDebts: simplify,
    createdAt: '',
    baseCurrency: 'INR',
    rates: {},
  });
  // The example: I owe Ravi ₹100 in group A, he owes me ₹30 in group B,
  // and separately I gave him ₹150 in cash. Overall he owes me ₹80.
  const A = g('A', ['me', 'ravi', 'x']);
  const B = g('B', ['me', 'ravi']);
  const ex: Expense[] = [
    exp('a1', 20000, 'ravi', { me: 10000, ravi: 10000 }, 'A'), // I owe ₹100
    exp('b1', 6000, 'me', { me: 3000, ravi: 3000 }, 'B'), // he owes ₹30
  ];
  const cash: Transfer = {
    id: 't1',
    kind: 'transfer',
    from: 'me',
    to: 'ravi',
    currency: 'INR',
    amount: 15000,
    date: '',
    createdAt: '',
  };

  it('counts transfers in the overall balance', () => {
    expect(pairBalanceInGroup('me', 'ravi', A, ex, [])).toBe(-10000);
    expect(pairBalanceInGroup('me', 'ravi', B, ex, [])).toBe(3000);
    expect(outsideBalances('me', [A, B], [], [cash])).toEqual({ ravi: { INR: 15000 } });
    expect(friendBalances('me', [A, B], ex, [], [cash])).toEqual({ ravi: { INR: 8000 } });
  });

  it('the other side sees the mirror image', () => {
    expect(friendBalances('ravi', [A, B], ex, [], [cash])).toEqual({ me: { INR: -8000 } });
  });

  it('plans one ₹80 payment that clears every group', () => {
    const plan = planOverallSettlement('me', 'ravi', 'INR', [A, B], ex, [], [cash]);
    expect(plan.total).toBe(8000);
    expect(plan.outside).toBe(15000);
    expect(plan.groupPayments).toEqual(
      expect.arrayContaining([
        { groupId: 'A', from: 'me', to: 'ravi', amount: 10000 },
        { groupId: 'B', from: 'ravi', to: 'me', amount: 3000 },
      ]),
    );
  });

  it('after settling, groups and the overall balance are all zero', () => {
    const plan = planOverallSettlement('me', 'ravi', 'INR', [A, B], ex, [], [cash]);
    const settlement: Transfer = {
      id: 's1',
      kind: 'settlement',
      from: 'ravi',
      to: 'me',
      currency: 'INR',
      amount: plan.total,
      date: '',
      createdAt: '',
    };
    const pays: Payment[] = plan.groupPayments.map((p, i) => ({
      id: 'p' + i,
      groupId: p.groupId,
      from: p.from,
      to: p.to,
      currency: 'INR',
      amount: p.amount,
      baseAmount: p.amount,
      date: '',
      settlementId: 's1',
    }));
    expect(pairBalanceInGroup('me', 'ravi', A, ex, pays)).toBe(0);
    expect(pairBalanceInGroup('me', 'ravi', B, ex, pays)).toBe(0);
    const overall = friendBalances('me', [A, B], ex, pays, [cash, settlement]);
    expect(overall.ravi?.INR ?? 0).toBe(0);
    // x's balance in group A is untouched
    expect(groupDebts(A, ex, pays).filter((d) => d.from === 'x' || d.to === 'x')).toEqual([]);
  });

  it('settles only groups in the chosen currency', () => {
    const usd: Group = { ...g('U', ['me', 'ravi']), baseCurrency: 'USD' };
    const ex2 = [...ex, { ...exp('u1', 4000, 'me', { me: 2000, ravi: 2000 }, 'U'), currency: 'USD' }];
    const all = friendBalances('me', [A, B, usd], ex2, [], [cash]);
    expect(all).toEqual({ ravi: { INR: 8000, USD: 2000 } });
    const plan = planOverallSettlement('me', 'ravi', 'INR', [A, B, usd], ex2, [], [cash]);
    expect(plan.groupPayments.some((p) => p.groupId === 'U')).toBe(false);
  });

  it('clears the pair even in a simplified group with re-routed debts', () => {
    // Group with four people; simplification routes debts through others.
    const G = g('G', ['me', 'ravi', 'x', 'y']);
    const ex3 = [
      exp('g1', 40000, 'ravi', { me: 10000, x: 10000, y: 10000, ravi: 10000 }, 'G'),
      exp('g2', 20000, 'y', { me: 5000, x: 5000, ravi: 5000, y: 5000 }, 'G'),
      exp('g3', 9000, 'me', { x: 9000 }, 'G'),
    ];
    const plan = planOverallSettlement('me', 'ravi', 'INR', [G], ex3, [], []);
    const pays: Payment[] = plan.groupPayments.map((p, i) => ({
      id: 'q' + i,
      groupId: 'G',
      from: p.from,
      to: p.to,
      currency: 'INR',
      amount: p.amount,
      baseAmount: p.amount,
      date: '',
      settlementId: 's2',
    }));
    expect(pairBalanceInGroup('me', 'ravi', G, ex3, pays)).toBe(0);
  });
});

describe('removing a friend', () => {
  const g = (id: string, members: string[], createdBy: string | null = 'u-me'): Group => ({
    id,
    name: id === 'g1' ? 'Goa' : 'Flat',
    memberIds: members,
    simplifyDebts: true,
    createdAt: '2026-01-01',
    baseCurrency: 'INR',
    rates: {},
    createdBy,
  });
  const base = (over: Partial<AppState> = {}): AppState => ({
    version: 1,
    meId: 'me',
    people: {
      me: { id: 'me', name: 'Surya', userId: 'u-me' },
      ravi: { id: 'ravi', name: 'Ravi', userId: 'u-ravi' },
      priya: { id: 'priya', name: 'Priya', userId: 'u-priya' },
    },
    groups: [],
    expenses: [],
    payments: [],
    transfers: [],
    activity: [],
    ...over,
  });
  const t = (from: string, to: string, amount: number): Transfer => ({
    id: `${from}-${to}-${amount}`,
    kind: 'transfer',
    from,
    to,
    currency: 'INR',
    amount,
    date: '2026-01-01',
    createdAt: '2026-01-01',
  });

  it('allows a friend with nothing between you', () => {
    expect(canRemoveFriend(base(), 'ravi', 'u-me', true)).toEqual({ ok: true, leaves: [] });
  });
  it('allows it when money outside groups adds up to nothing', () => {
    const r = canRemoveFriend(base({ transfers: [t('me', 'ravi', 500), t('ravi', 'me', 500)] }), 'ravi', 'u-me', true);
    expect(r.ok).toBe(true);
  });
  it('refuses while you are not settled up', () => {
    const r = canRemoveFriend(base({ transfers: [t('me', 'ravi', 500)] }), 'ravi', 'u-me', true);
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('settled up') });
  });
  it('takes them out of your groups that have nothing of theirs', () => {
    const r = canRemoveFriend(base({ groups: [g('g1', ['me', 'ravi'])] }), 'ravi', 'u-me', true);
    expect(r.ok && r.leaves.map((x) => x.id)).toEqual(['g1']);
  });
  it('refuses while they are in a group someone else created', () => {
    const r = canRemoveFriend(base({ groups: [g('g1', ['me', 'ravi', 'priya'], 'u-priya')] }), 'ravi', 'u-me', true);
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('which Priya created') });
  });
  it('on this phone only, every group is yours', () => {
    const r = canRemoveFriend(base({ groups: [g('g1', ['me', 'ravi'], null)] }), 'ravi', null, false);
    expect(r.ok).toBe(true);
  });
  it('refuses while they are in the expenses of a group, even when settled', () => {
    const e = exp('e1', 1000, 'ravi', { me: 500, ravi: 500 }, 'g1');
    const pay: Payment = { id: 'p', groupId: 'g1', from: 'me', to: 'ravi', currency: 'INR', amount: 500, baseAmount: 500, date: '2026-01-02' };
    const r = canRemoveFriend(base({ groups: [g('g1', ['me', 'ravi'])], expenses: [e], payments: [pay] }), 'ravi', 'u-me', true);
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('delete that group first') });
  });
  it('never removes you', () => {
    expect(canRemoveFriend(base(), 'me', 'u-me', true).ok).toBe(false);
  });
});
