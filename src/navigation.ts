import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type RootStackParamList = {
  Onboarding: undefined;
  Home: undefined;
  Group: { groupId: string };
  GroupSummary: { groupId: string };
  GroupForm: { groupId?: string };
  ExpenseForm: { groupId: string; expenseId?: string };
  SettleUp: { groupId: string; from?: string; to?: string; amount?: number; paymentId?: string };
  Friend: { friendId: string };
  FriendForm: { personId?: string };
  Transfer: { transferId?: string; from?: string; to?: string };
  SettleAll: { friendId: string; currency?: string };
  About: undefined;
  Join: { code?: string; invite?: string };
};

export type ScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, T>;
