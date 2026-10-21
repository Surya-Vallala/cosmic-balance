// Random groups like a real trip: two currencies, several payers, uneven splits and payments.
import { describe, expect, it } from 'vitest';
import { computeSplit, groupLedger, groupNet, netBalances, pairwiseDebts, simplifyDebts, toBase } from './logic';
import type { Expense, Group, Payment, SplitType } from './types';

let seed = 12345;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];

describe('balances always add up (random trips)', () => {
  it('3000 random groups', () => {
    for (let run = 0; run < 3000; run++) {
      const people = Array.from({ length: 2 + Math.floor(rnd() * 10) }, (_, i) => `p${i}`);
      const group: Group = { id: 'g', name: 'Trip', memberIds: people, simplifyDebts: true, createdAt: '', baseCurrency: 'INR', rates: { THB: 2.9252 } };
      const expenses: Expense[] = [];
      for (let i = 0; i < 1 + Math.floor(rnd() * 25); i++) {
        const cur = rnd() < 0.6 ? 'THB' : 'INR';
        const amount = 100 + Math.floor(rnd() * 5_000_000);
        const payers = people.filter(() => rnd() < 0.3);
        if (!payers.length) payers.push(pick(people));
        const each = Math.floor(amount / payers.length);
        const paid = Object.fromEntries(payers.map((p, k) => [p, k === 0 ? amount - each * (payers.length - 1) : each]));
        const type = pick<SplitType>(['equal', 'shares', 'percent']);
        const inSplit = people.filter(() => rnd() < 0.7);
        if (!inSplit.length) inSplit.push(pick(people));
        const inputs: Record<string, string> =
          type === 'shares' ? Object.fromEntries(inSplit.map((p) => [p, String(1 + Math.floor(rnd() * 3))])) :
          type === 'percent' ? Object.fromEntries(inSplit.map((p, k) => [p, String(k === 0 ? 100 - Math.floor(100 / inSplit.length) * (inSplit.length - 1) : Math.floor(100 / inSplit.length))])) : {};
        const r = computeSplit(amount, type, type === 'equal' ? inSplit : people, inputs, cur);
        if (!r.ok) throw new Error(r.error);
        expect(Object.values(r.shares).reduce((a, b) => a + b, 0)).toBe(amount); // a split always adds up to the bill
        expenses.push({ id: `e${i}`, groupId: 'g', description: '', currency: cur, amount, payers: paid, splitType: type, participants: Object.keys(r.shares), inputs, shares: r.shares, date: '', createdAt: '' });
      }
      const payments: Payment[] = [];
      for (let i = 0; i < Math.floor(rnd() * 6); i++) {
        const from = pick(people), to = pick(people.filter((x) => x !== from));
        if (!to) continue;
        const cur = rnd() < 0.5 ? 'THB' : 'INR';
        const amount = 100 + Math.floor(rnd() * 500_000);
        payments.push({ id: `p${i}`, groupId: 'g', from, to, currency: cur, amount, baseAmount: toBase(group, amount, cur), date: '' });
      }
      const net = groupNet(group, expenses, payments);
      // 1. Nothing is lost or made up: what's owed to people equals what others owe.
      expect(Object.values(net).reduce((a, b) => a + b, 0)).toBe(0);
      // 2. Each converted expense still adds up (payers and shares re-divided exactly).
      const l = groupLedger(group, expenses, payments);
      for (const e of l.expenses) {
        expect(Object.values(e.payers).reduce((a, b) => a + b, 0)).toBe(Object.values(e.shares).reduce((a, b) => a + b, 0));
      }
      // 3. The simplified "who pays whom" settles everyone exactly, in at most people − 1 payments.
      const check = (debts: { from: string; to: string; amount: number }[]) => {
        const left = { ...net };
        for (const d of debts) { left[d.from] += d.amount; left[d.to] -= d.amount; }
        for (const v of Object.values(left)) expect(v).toBe(0);
      };
      const simple = simplifyDebts(net);
      check(simple);
      expect(simple.length).toBeLessThanOrEqual(people.length - 1);
      // 4. Without simplifying (direct pairs), it settles everyone exactly too.
      check(pairwiseDebts(l.expenses, l.payments));
      expect(netBalances(l.expenses, l.payments)).toEqual(net);
    }
  });
});
