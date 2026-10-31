// Starting points for Money: settings, and the common categories offered at setup.
import type { CurrencyCode } from '../types';
import type { Category, MoneyData, MoneySettings } from './types';

export function defaultSettings(currency: CurrencyCode = 'INR'): MoneySettings {
  return {
    enabled: false,
    startedOn: null,
    currency,
    rates: {},
    budget: null,
    usual: {},
    groupCategory: {},
    opensOn: 'daily',
    monthStart: 1,
    weekStart: 1,
    showTime: false,
    showDetails: false,
    suggestNotes: true,
    subcategories: true,
    introSeen: false,
    tips: [],
  };
}

export function emptyMoney(currency: CurrencyCode = 'INR'): MoneyData {
  return { settings: defaultSettings(currency), accounts: {}, categories: {}, records: {}, repeats: {}, links: {} };
}

// Fixed ids, so setting up on two phones at once doesn't make two of each.
const EXPENSE: [string, string, string[]][] = [
  ['food', 'Food', ['Groceries', 'Eating out', 'Snacks']],
  ['car', 'Car', ['Fuel', 'Maintenance', 'Insurance', 'Parking and tolls']],
  ['home', 'Home', ['Rent', 'Maintenance', 'Electricity', 'Internet', 'Help']],
  ['travel', 'Travel', ['Flights', 'Stay', 'Local travel']],
  ['bills', 'Bills', ['Phone', 'Subscriptions']],
  ['shopping', 'Shopping', ['Clothes', 'Electronics']],
  ['health', 'Health', []],
  ['fun', 'Entertainment', []],
  ['education', 'Education', []],
  ['gifts', 'Gifts', []],
  ['personal', 'Personal', []],
  ['emi', 'EMI and loans', []],
  ['other', 'Other', []],
];
const INCOME: [string, string][] = [
  ['salary', 'Salary'],
  ['business', 'Business'],
  ['interest', 'Interest'],
  ['gift', 'Gifts'],
  ['refund', 'Refunds'],
  ['other', 'Other'],
];

/** The common categories (Food, Car › Fuel, Home › Maintenance…). */
export function commonCategories(): Category[] {
  const out: Category[] = [];
  EXPENSE.forEach(([key, name, subs], i) => {
    const id = `c-x-${key}`;
    out.push({ id, kind: 'expense', name, parentId: null, order: i });
    subs.forEach((sub, j) =>
      out.push({ id: `${id}-${sub.toLowerCase().replace(/[^a-z]+/g, '-')}`, kind: 'expense', name: sub, parentId: id, order: j }),
    );
  });
  INCOME.forEach(([key, name], i) => out.push({ id: `c-i-${key}`, kind: 'income', name, parentId: null, order: i }));
  return out;
}
