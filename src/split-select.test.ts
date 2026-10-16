import { describe, expect, it } from 'vitest';
import { computeSplit, inSplit, mostPickedFirst, pickCounts, startingInputs } from './logic';
import type { Expense, Transfer } from './types';

const members = ['me', 'ravi', 'priya', 'kiran', 'anu'];

describe('who is in the split', () => {
  it('Equally: the ticked people', () => {
    expect(inSplit('equal', members, ['priya', 'me'], {})).toEqual(['me', 'priya']);
  });
  it('other kinds: everyone with a value above zero', () => {
    expect(inSplit('shares', members, [], { me: '2', ravi: '0', priya: '', kiran: '1' })).toEqual(['me', 'kiran']);
    expect(inSplit('exact', members, [], { ravi: '120.50', anu: 'x' })).toEqual(['ravi']);
  });
});

describe('starting values when switching', () => {
  const picked = ['me', 'ravi', 'priya'];
  it('shares: 1 each for the ticked people only', () => {
    expect(startingInputs('shares', picked, 90000)).toEqual({ me: '1', ravi: '1', priya: '1' });
  });
  it('percent: equal, adding up to exactly 100', () => {
    const p = startingInputs('percent', picked, 90000);
    expect(Object.keys(p)).toEqual(picked);
    expect(Object.values(p).reduce((a, v) => a + Number(v), 0)).toBeCloseTo(100, 6);
    const r = computeSplit(100000, 'percent', members, p);
    expect(r.ok && Object.keys(r.shares).sort()).toEqual(['me', 'priya', 'ravi']);
  });
  it('amounts: equal parts of the total, adding up exactly', () => {
    const a = startingInputs('exact', picked, 100000); // ₹1,000 among 3
    const r = computeSplit(100000, 'exact', members, a);
    expect(r.ok).toBe(true);
    expect(r.ok && Object.keys(r.shares).sort()).toEqual(['me', 'priya', 'ravi']);
  });
  it('amounts with no total yet: blank', () => {
    expect(startingInputs('exact', picked, null)).toEqual({});
  });
  it('nobody picked: nothing filled in', () => {
    expect(startingInputs('shares', [], 100)).toEqual({});
  });
});


describe('regulars first in friend pickers', () => {
  const ex = (id: string, people: string[], at: string): Expense => ({
    id, groupId: null, description: id, currency: 'INR', amount: 100, payers: { [people[0]]: 100 }, splitType: 'equal',
    participants: people, inputs: {}, shares: Object.fromEntries(people.map((p) => [p, 100 / people.length])), date: at, createdAt: at,
  });
  const expenses = [
    ex('a', ['me', 'priya'], '2026-10-01'),
    ex('b', ['me', 'priya', 'kiran'], '2026-10-02'),
    ex('c', ['ravi', 'kiran'], '2026-10-03'), // not mine: doesn't count
    ex('d', ['me', 'anu'], '2026-10-04'),
  ];
  const transfers: Transfer[] = [{ id: 't', kind: 'transfer', from: 'kiran', to: 'me', currency: 'INR', amount: 1, date: '2026-10-05', createdAt: '2026-10-05' }];
  it('counts expenses together and money given', () => {
    expect(pickCounts('me', expenses, transfers)).toEqual({ priya: 2, kiran: 2, anu: 1 });
  });
  it('most picked first, then most recent, then by name', () => {
    const people = ['anu', 'deepak', 'kiran', 'priya', 'ravi'].map((id) => ({ id, name: id }));
    const last = { kiran: '2026-10-05', priya: '2026-10-02', anu: '2026-10-04' };
    expect(mostPickedFirst(people, pickCounts('me', expenses, transfers), last).map((p) => p.id)).toEqual([
      'kiran', 'priya', 'anu', 'deepak', 'ravi',
    ]);
  });
});
