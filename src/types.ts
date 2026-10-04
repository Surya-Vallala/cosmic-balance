// All money values are stored as integers in hundredths of their currency
// (paise, satang, cents) to avoid floating-point rounding errors.

export type Id = string;
export type CurrencyCode = string;

export interface Person {
  id: Id;
  name: string;
  upiId?: string;
  /**
   * Shared mode only: the account behind this person. Set for people who
   * have signed in; empty for friends added by name who haven't joined yet.
   */
  userId?: string | null;
  /**
   * Shared mode only: their email. For a friend who hasn't joined yet, the
   * Gmail address that links them automatically when they sign in.
   */
  email?: string | null;
  /**
   * Shared mode only: you see them only because they asked to join a group
   * you run. Not a friend (yet), so left out of friends lists and pickers.
   */
  requesting?: boolean;
}

export interface Group {
  id: Id;
  name: string;
  memberIds: Id[];
  simplifyDebts: boolean;
  createdAt: string;
  /** Balances and settle-ups are worked out in this currency. */
  baseCurrency: CurrencyCode;
  /**
   * Other currencies the group spends in, with the rate the group agreed:
   * how many units of `baseCurrency` one unit is worth (THB: 2.87 means
   * ฿1 = ₹2.87). Empty for a single-currency group.
   */
  rates: Record<CurrencyCode, number>;
  /** Shared mode only: code for the group's invite link. */
  inviteCode?: string;
  /** Shared mode only: account that created the group (only it can delete). */
  createdBy?: string | null;
}

export type SplitType = 'equal' | 'exact' | 'percent' | 'shares';

export interface Expense {
  id: Id;
  /** The group it's in, or null for an expense between friends outside any group. */
  groupId: Id | null;
  description: string;
  /** Currency the bill was paid in. Every amount below is in this currency. */
  currency: CurrencyCode;
  amount: number;
  // Who paid and how much. One entry when a single person paid; several
  // when the bill was paid jointly. Always sums to `amount`.
  payers: Record<Id, number>;
  splitType: SplitType;
  participants: Id[];
  // Raw values typed by the user (amounts, percents or share counts), kept so
  // the expense can be edited later exactly as entered.
  inputs: Record<Id, string>;
  // Computed share of each participant. Always sums to `amount`.
  shares: Record<Id, number>;
  date: string;
  createdAt: string;
}

export interface Payment {
  id: Id;
  groupId: Id;
  from: Id; // who paid
  to: Id; // who received
  currency: CurrencyCode;
  amount: number; // in `currency`
  /** What the payment was worth in the group's main currency when recorded. */
  baseAmount: number;
  date: string;
  /**
   * Set when this payment was written automatically by an overall settle-up
   * between two friends (see Transfer kind 'settlement'). No money moved in
   * the group itself; it records that the group balance was cleared.
   */
  settlementId?: Id;
}

/**
 * Money between two people outside any group.
 * - 'transfer': one person gave the other money (cash, a UPI transfer…).
 * - 'settlement': an overall settle-up that cleared everything between two
 *   friends across all groups; `amount` is the money that actually changed
 *   hands, and the group balances it cleared are recorded as payments with
 *   this transfer's id as their `settlementId`.
 */
export interface Transfer {
  id: Id;
  kind: 'transfer' | 'settlement';
  from: Id; // who gave the money
  to: Id; // who received it
  currency: CurrencyCode;
  amount: number;
  note?: string;
  date: string;
  createdAt: string;
}

export interface Activity {
  id: Id;
  at: string;
  groupId?: Id;
  text: string;
}

/** Shared mode: something that happened that concerns you (no amounts). */
export interface Notice {
  id: Id;
  kind: string;
  body: string;
  groupId?: Id | null;
  personId?: Id | null;
  createdAt: string;
  read: boolean;
}

/** Shared mode: someone who opened your friend link and asked to be friends (or your own request). */
export interface FriendRequest {
  id: Id;
  /** Who asked. */
  fromPerson: Id;
  /** The account it was sent to. */
  toUser: string;
  createdAt: string;
}

/** Shared mode: someone who opened a group's link and asked to join. */
export interface JoinRequest {
  id: Id;
  groupId: Id;
  personId: Id;
  createdAt: string;
}

export interface AppState {
  version: 1;
  meId: Id | null;
  people: Record<Id, Person>;
  groups: Group[];
  expenses: Expense[];
  payments: Payment[];
  transfers: Transfer[];
  activity: Activity[];
  /** Shared mode only. */
  notices?: Notice[];
  /** Shared mode only: requests you can see (yours, and to groups you let people into). */
  joinRequests?: JoinRequest[];
  /** Shared mode only: friend requests sent to you, and ones you sent. */
  friendRequests?: FriendRequest[];
}

export interface Debt {
  from: Id;
  to: Id;
  amount: number;
}

/** Amounts in several currencies, e.g. { INR: 45000, USD: 2000 }. */
export type Totals = Record<CurrencyCode, number>;
