// Money: your own accounts, income and spending. Private: only you see any of
// it. Kept apart from the shared splitting data; in shared mode it's saved to
// a table only your account can read (money_items), in local mode on this phone.
//
// Amounts are integers in hundredths of their currency, like everywhere else.

import type { CurrencyCode, Id } from '../types';

export type AccountType = 'cash' | 'bank' | 'card' | 'wallet' | 'travel' | 'investment' | 'lent' | 'loan' | 'other';

export interface AccountTypeInfo {
  id: AccountType;
  /** One account: "Credit card". */
  one: string;
  /** The heading over several: "Cards". */
  many: string;
  /** Money you owe (a card's bill, a loan): its balance is entered as an amount owed. */
  owed?: boolean;
}

export const ACCOUNT_TYPES: AccountTypeInfo[] = [
  { id: 'cash', one: 'Cash', many: 'Cash' },
  { id: 'bank', one: 'Bank account', many: 'Bank accounts' },
  { id: 'card', one: 'Credit card', many: 'Cards', owed: true },
  { id: 'wallet', one: 'Wallet / UPI', many: 'Wallets and UPI' },
  { id: 'travel', one: 'Forex card', many: 'Travel money' },
  { id: 'investment', one: 'Investment', many: 'Investments' },
  { id: 'lent', one: 'Money lent', many: 'Money lent' },
  { id: 'loan', one: 'Loan / EMI', many: 'Loans and EMIs', owed: true },
  { id: 'other', one: 'Other', many: 'Other' },
];

export const accountType = (t: AccountType): AccountTypeInfo => ACCOUNT_TYPES.find((x) => x.id === t) ?? ACCOUNT_TYPES[8];

export interface Account {
  id: Id;
  name: string;
  type: AccountType;
  currency: CurrencyCode;
  /**
   * The balance when it was added, before anything recorded here. For a card
   * or loan, what you owe is a negative balance.
   */
  opening: number;
  /** A line under the name: "bill due 12th", "matures 4 Mar 2027". */
  note?: string;
  /** Deleted: not offered for new records, but past records keep it (and it can be brought back). */
  hidden?: boolean;
  order: number;
  createdAt: string;
}

export type CategoryKind = 'expense' | 'income';

export interface Category {
  id: Id;
  kind: CategoryKind;
  name: string;
  /** A sub-category's parent (one level only): Car › Fuel. */
  parentId: Id | null;
  order: number;
  hidden?: boolean;
}

export type RecordKind = 'expense' | 'income' | 'transfer';

/** Something you record yourself in Money. */
export interface MoneyRecord {
  id: Id;
  kind: RecordKind;
  /** When it happened. */
  date: string;
  /** In the account's currency, always positive. */
  amount: number;
  accountId: Id;
  /** Transfer: where the money went, and what arrived there (differs between currencies). */
  toAccountId?: Id;
  toAmount?: number;
  /** Expense or income: its category (a sub-category or a top one). */
  categoryId?: Id | null;
  note?: string;
  details?: string;
  /** Made automatically by a repeating transaction. */
  repeatId?: Id;
  createdAt: string;
  updatedAt: string;
}

export type RepeatEvery = 'day' | 'week' | 'month' | 'year';

/** A transaction that repeats (rent, an EMI, a subscription). */
export interface Repeat {
  id: Id;
  every: RepeatEvery;
  /** The first day (YYYY-MM-DD); later ones fall on the same weekday / date. */
  start: string;
  /** The last day one was made for. */
  lastMade: string | null;
  /** Stop after this day (optional). */
  until?: string | null;
  template: Pick<MoneyRecord, 'kind' | 'amount' | 'accountId' | 'toAccountId' | 'toAmount' | 'categoryId' | 'note' | 'details'>;
}

/**
 * Your private note on something in Split: which of your accounts paid an
 * expense or received a settle-up, and what your share counts as. Keyed
 * 'e:<expense id>', 'p:<payment id>' or 't:<transfer id>'. Friends never see it.
 */
/** What Money counted for a split item, kept for when it's no longer in Split (you left the group). */
export interface FrozenEntry {
  kind: 'share' | 'paid' | 'settle';
  date: string;
  amount: number;
  currency: CurrencyCode;
  /** Your share, in the main currency when it was kept. */
  expense: number;
  title: string;
  info: string;
  groupId: Id | null;
  groupName: string;
  categoryId?: Id | null;
  moved?: number;
  /** What it changed in its account, in that account's currency. */
  change?: number;
}

export interface SplitLink {
  id: string;
  /** The account; null means "Don't track" (or "Didn't get it yet"). */
  accountId: Id | null;
  /** What the account was charged, when its currency isn't the item's. */
  amount?: number;
  /** An expense: the category your share counts as (else the group's). */
  categoryId?: Id | null;
  at: string;
  /** Kept when you left the group, so your spending and balances don't change. */
  frozen?: FrozenEntry;
}

export type MoneyView = 'daily' | 'calendar' | 'monthly' | 'total';

export interface MoneySettings {
  enabled: boolean;
  /** The day Money was first turned on: group shares count from then (nothing earlier changes). */
  startedOn: string | null;
  /** Totals are shown in this currency. */
  currency: CurrencyCode;
  /** Other currencies: how many main-currency units one unit is worth. */
  rates: Record<CurrencyCode, number>;
  /** A monthly spending budget in the main currency. */
  budget: number | null;
  /** The account you usually pay with in each group ('outside' for no group); null = Don't track. */
  usual: Record<string, Id | null>;
  /** The category each group's shares count as ('outside' for no group). */
  groupCategory: Record<string, Id>;
  opensOn: MoneyView;
  /** Day of the month a month starts (1–28), for people paid on the 25th. */
  monthStart: number;
  /** 0 Sunday, 1 Monday. */
  weekStart: 0 | 1;
  showTime: boolean;
  showDetails: boolean;
  suggestNotes: boolean;
  /** Offer sub-categories when recording. */
  subcategories: boolean;
  /** The one-time "New in Cosmic Balance" card was answered. */
  introSeen: boolean;
  /** One-time tips already shown. */
  tips: string[];
}

export interface MoneyData {
  settings: MoneySettings;
  accounts: Record<Id, Account>;
  categories: Record<Id, Category>;
  records: Record<Id, MoneyRecord>;
  repeats: Record<Id, Repeat>;
  links: Record<string, SplitLink>;
}

/** How each piece is saved (one row each in money_items). */
export type ItemKind = 'settings' | 'account' | 'category' | 'record' | 'repeat' | 'link';

export interface Item {
  kind: ItemKind;
  id: string;
  /** null: deleted. */
  data: unknown | null;
}
