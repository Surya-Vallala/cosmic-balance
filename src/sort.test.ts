import { describe, expect, it } from 'vitest';
import { lastFriendActivity, lastGroupActivity, sortForHome } from './logic';
import type { Expense, Group, Payment, Transfer } from './types';

const group = (id: string, name: string, createdAt: string): Group => ({
  id, name, memberIds: ['me', 'ravi', 'priya'], simplifyDebts: true, createdAt, baseCurrency: 'INR', rates: {},
});
const expense = (id: string, groupId: string | null, people: string[], createdAt: string, updatedAt?: string): Expense => ({
  id, groupId, description: id, currency: 'INR', amount: 300, payers: { [people[0]]: 300 }, splitType: 'equal',
  participants: people, inputs: {}, shares: Object.fromEntries(people.map((p) => [p, 300 / people.length])),
  date: createdAt, createdAt, updatedAt,
});

const groups = [group('goa', 'Goa', '2026-09-01T00:00:00Z'), group('flat', 'Flat', '2026-08-01T00:00:00Z'), group('new', 'Badminton', '2026-10-10T00:00:00Z')];
const expenses = [
  expense('e1', 'goa', ['me', 'ravi'], '2026-10-01T10:00:00Z'),
  expense('e2', 'flat', ['ravi', 'priya'], '2026-09-20T10:00:00Z', '2026-10-15T09:00:00Z'), // edited yesterday, without me
  expense('e3', null, ['me', 'priya'], '2026-10-12T10:00:00Z'),
];
const payments: Payment[] = [{ id: 'p1', groupId: 'goa', from: 'ravi', to: 'me', currency: 'INR', amount: 100, baseAmount: 100, date: '2026-10-14T10:00:00Z' }];
const transfers: Transfer[] = [{ id: 't1', kind: 'transfer', from: 'me', to: 'kiran', currency: 'INR', amount: 500, date: '2026-10-02T00:00:00Z', createdAt: '2026-10-02T00:00:00Z' }];

describe('home screen order', () => {
  it('groups: latest expense, edit or payment, else when the group was made', () => {
    const last = lastGroupActivity(groups, expenses, payments);
    expect(last).toEqual({ goa: '2026-10-14T10:00:00Z', flat: '2026-10-15T09:00:00Z', new: '2026-10-10T00:00:00Z' });
    expect(sortForHome(groups, 'recent', last, () => 0).map((g) => g.id)).toEqual(['flat', 'goa', 'new']);
  });
  it('friends: only things you share count, including transfers and outside expenses', () => {
    const last = lastFriendActivity('me', expenses, payments, transfers);
    expect(last).toEqual({ ravi: '2026-10-14T10:00:00Z', priya: '2026-10-12T10:00:00Z', kiran: '2026-10-02T00:00:00Z' });
    const friends = [{ id: 'anu', name: 'Anu' }, { id: 'kiran', name: 'Kiran' }, { id: 'priya', name: 'Priya' }, { id: 'ravi', name: 'Ravi' }];
    expect(sortForHome(friends, 'recent', last, () => 0).map((f) => f.id)).toEqual(['ravi', 'priya', 'kiran', 'anu']);
  });
  it('by name ignores case; by balance puts the biggest first, then the most recent', () => {
    const items = [{ id: 'a', name: 'zara' }, { id: 'b', name: 'Arjun' }, { id: 'c', name: 'meera' }];
    expect(sortForHome(items, 'name', {}, () => 0).map((x) => x.name)).toEqual(['Arjun', 'meera', 'zara']);
    const size = (id: string) => ({ a: 500, b: 500, c: 900 })[id] ?? 0;
    const last = { a: '2026-10-01', b: '2026-10-05' };
    expect(sortForHome(items, 'balance', last, size).map((x) => x.id)).toEqual(['c', 'b', 'a']);
  });
});
