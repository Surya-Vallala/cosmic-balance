import { describe, expect, it } from 'vitest';
import { applyItems, coalesce, removeAccount, removeCategory, repeatsDue, rowsToItems, settingsItems, turnOn, withDefaults } from './data';
import { commonCategories, emptyMoney } from './defaults';
import type { Account, Item, MoneyData } from './types';

const acc = (id: string): Account => ({ id, name: id, type: 'bank', currency: 'INR', opening: 0, order: 0, createdAt: '' });

function base(): MoneyData {
  const m = emptyMoney();
  m.accounts = { a: acc('a'), b: acc('b') };
  for (const c of commonCategories()) m.categories[c.id] = c;
  return m;
}

describe('applying changes', () => {
  it('adds, replaces and deletes', () => {
    const m = base();
    const next = applyItems(m, [
      { kind: 'account', id: 'c', data: acc('c') },
      { kind: 'account', id: 'a', data: { ...acc('a'), name: 'HDFC' } },
      { kind: 'account', id: 'b', data: null },
      { kind: 'record', id: 'r1', data: { kind: 'expense', amount: 1, accountId: 'a', date: 'x' } },
    ]);
    expect(Object.keys(next.accounts).sort()).toEqual(['a', 'c']);
    expect(next.accounts.a.name).toBe('HDFC');
    expect(next.records.r1.id).toBe('r1');
    expect(m.accounts.b).toBeDefined(); // the original is untouched
  });
  it('fills in settings an older version never saved', () => {
    const next = applyItems(emptyMoney(), [{ kind: 'settings', id: 'settings', data: { enabled: true, currency: 'THB' } }]);
    expect(next.settings.enabled).toBe(true);
    expect(next.settings.currency).toBe('THB');
    expect(next.settings.usual).toEqual({});
    expect(next.settings.monthStart).toBe(1);
    expect(withDefaults(null).enabled).toBe(false);
  });
  it('keeps only the latest change to each item, in order', () => {
    const q: Item[] = [
      { kind: 'account', id: 'a', data: 1 },
      { kind: 'record', id: 'a', data: 2 },
    ];
    expect(coalesce(q, [{ kind: 'account', id: 'a', data: 3 }])).toEqual([
      { kind: 'record', id: 'a', data: 2 },
      { kind: 'account', id: 'a', data: 3 },
    ]);
  });
  it('reads rows from the server', () => {
    expect(
      rowsToItems([
        { id: 'a', kind: 'account', data: { name: 'x' }, deleted: false },
        { id: 'b', kind: 'record', data: {}, deleted: true },
        { id: 'c', kind: 'mystery', data: {}, deleted: false },
      ]),
    ).toEqual([
      { kind: 'account', id: 'a', data: { name: 'x' } },
      { kind: 'record', id: 'b', data: null },
    ]);
  });
});

describe('deleting accounts and categories', () => {
  it('hides an account with history, deletes an unused one, and stops it being anyone’s usual', () => {
    const m = base();
    m.records = { r: { id: 'r', kind: 'expense', amount: 1, accountId: 'a', date: '', createdAt: '', updatedAt: '' } };
    m.settings.usual = { g1: 'a', g2: 'b' };
    expect(removeAccount(m, 'a')).toEqual([
      { kind: 'account', id: 'a', data: { ...m.accounts.a, hidden: true } },
      { kind: 'settings', id: 'settings.usual.g1', data: null },
    ]);
    expect(removeAccount(m, 'b')[0]).toEqual({ kind: 'account', id: 'b', data: null });
  });
  it('takes sub-categories with a category, hiding the ones in use', () => {
    const m = base();
    m.records = { r: { id: 'r', kind: 'expense', amount: 1, accountId: 'a', categoryId: 'c-x-car-fuel', date: '', createdAt: '', updatedAt: '' } };
    const items = removeCategory(m, 'c-x-car');
    const fuel = items.find((i) => i.id === 'c-x-car-fuel');
    const ins = items.find((i) => i.id === 'c-x-car-insurance');
    const car = items.find((i) => i.id === 'c-x-car');
    expect((fuel?.data as { hidden?: boolean }).hidden).toBe(true);
    expect(ins?.data).toBeNull();
    expect((car?.data as { hidden?: boolean }).hidden).toBe(true); // its sub-category is in use
    expect(items).toHaveLength(5);
  });
});

describe('turning Money on', () => {
  it('starts counting group shares today, the first time only', () => {
    const m = emptyMoney();
    const items = turnOn(m, { today: '2026-10-31', currency: 'INR', categories: true, accounts: [acc('cash')] });
    const on = applyItems(m, items);
    expect(on.settings.enabled).toBe(true);
    expect(on.settings.startedOn).toBe('2026-10-31');
    expect(on.settings.introSeen).toBe(true);
    expect(Object.keys(on.categories).length).toBeGreaterThan(20);
    expect(Object.keys(on.accounts)).toEqual(['cash']);
    const off = applyItems(on, settingsItems(on.settings, { ...on.settings, enabled: false }));
    const again = applyItems(off, turnOn(off, { today: '2026-12-01', categories: true }));
    expect(again.settings.startedOn).toBe('2026-10-31');
    expect(Object.keys(again.categories).length).toBe(Object.keys(on.categories).length);
  });
});

describe('settings, one at a time', () => {
  it('saves only what changed, map entries one by one', () => {
    const s = emptyMoney().settings;
    expect(settingsItems(s, { ...s, budget: 7000000, usual: { g1: 'a', g2: null } })).toEqual([
      { kind: 'settings', id: 'settings.budget', data: { value: 7000000 } },
      { kind: 'settings', id: 'settings.usual.g1', data: { value: 'a' } },
      { kind: 'settings', id: 'settings.usual.g2', data: { value: null } },
    ]);
    expect(settingsItems(s, { ...s })).toEqual([]);
  });
  it('lets two phones change different settings without undoing each other', () => {
    const start = applyItems(emptyMoney(), settingsItems(emptyMoney().settings, { ...emptyMoney().settings, usual: { g1: 'a' } }));
    // Phone A sets a budget; phone B (still on the old copy) picks Don't track for g2.
    const fromA = settingsItems(start.settings, { ...start.settings, budget: 500000 });
    const fromB = settingsItems(start.settings, { ...start.settings, usual: { ...start.settings.usual, g2: null } });
    const both = applyItems(applyItems(start, fromA), fromB);
    expect(both.settings.budget).toBe(500000);
    expect(both.settings.usual).toEqual({ g1: 'a', g2: null });
    const removed = applyItems(both, [{ kind: 'settings', id: 'settings.usual.g1', data: null }]);
    expect(removed.settings.usual).toEqual({ g2: null });
  });
  it('still reads a whole-settings row, and ignores settings it doesn’t know', () => {
    const m = applyItems(emptyMoney(), [
      { kind: 'settings', id: 'settings', data: { enabled: true, budget: 1 } },
      { kind: 'settings', id: 'settings.someday', data: { value: 1 } },
    ]);
    expect(m.settings.enabled).toBe(true);
    expect(m.settings.budget).toBe(1);
    expect('someday' in m.settings).toBe(false);
  });
});

describe('repeating transactions', () => {
  it('makes what is due once, even when another phone made one already', () => {
    const m = base();
    m.repeats = {
      rent: { id: 'rent', every: 'month', start: '2026-09-05', lastMade: null, template: { kind: 'expense', amount: 100, accountId: 'a' } },
    };
    m.records = { 'rent-2026-09-05': { id: 'rent-2026-09-05', kind: 'expense', amount: 120, accountId: 'a', date: '', createdAt: '', updatedAt: '' } };
    const items = repeatsDue(m, '2026-10-31', 'now');
    expect(items.map((i) => `${i.kind}:${i.id}`)).toEqual(['record:rent-2026-10-05', 'repeat:rent']);
    const after = applyItems(m, items);
    expect(after.records['rent-2026-09-05'].amount).toBe(120);
    expect(after.repeats.rent.lastMade).toBe('2026-10-05');
    expect(repeatsDue(after, '2026-10-31', 'now')).toEqual([]);
  });
});
