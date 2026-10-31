import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type RootStackParamList = {
  Onboarding: undefined;
  Home: undefined;
  Group: { groupId: string };
  GroupSummary: { groupId: string };
  GroupForm: { groupId?: string };
  /** No groupId: an expense outside groups, with the friends in `with` (comma-separated ids). */
  ExpenseForm: { groupId?: string; expenseId?: string; with?: string };
  /** Expenses outside groups. */
  Outside: undefined;
  SettleUp: { groupId: string; from?: string; to?: string; amount?: number; paymentId?: string };
  Friend: { friendId: string };
  FriendForm: { personId?: string };
  Transfer: { transferId?: string; from?: string; to?: string };
  SettleAll: { friendId: string; currency?: string };
  About: undefined;
  Join: { code?: string; invite?: string; friend?: string };
  Notifications: undefined;

  // Money (only you see it)
  /** cat: show just this category; month: "2026-10". */
  Money: { cat?: string; month?: string } | undefined;
  Stats: undefined;
  Accounts: undefined;
  More: undefined;
  /** Record income, spending or a transfer between your accounts (or edit one). */
  Record: { recordId?: string; kind?: 'expense' | 'income' | 'transfer'; accountId?: string; copyOf?: string } | undefined;
  MoneySearch: undefined;
  Account: { accountId: string };
  AccountForm: { accountId?: string } | undefined;
  Categories: { kind?: 'expense' | 'income' } | undefined;
  /** Split items waiting for you to say which account. */
  SortOut: undefined;
  /** Turning Money on: three steps, then your accounts. */
  MoneySetup: { step?: number } | undefined;
  Repeats: undefined;
  /** The usual account and category for each group. */
  GroupMoney: undefined;
};

export type ScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, T>;
