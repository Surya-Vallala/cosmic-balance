import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { shortDate } from '../dates';
import { expensePeople, nonGroupExpenses } from '../logic';
import { formatMoney } from '../money';
import type { ScreenProps } from '../navigation';
import { useName, useStore } from '../store';
import { colors, fonts, space } from '../theme';
import type { Expense } from '../types';
import { Button, Empty, List, Row, Screen } from '../ui';

/** "Ravi", "Ravi and Priya" or "Ravi, Priya and 2 more". */
export function namesList(names: string[]): string {
  if (names.length <= 1) return names.join('');
  if (names.length <= 3) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
}

/** One expense outside groups, as a row: what it was, who with, and what it means for you. */
export function OutsideExpenseRow({ e, last, onPress }: { e: Expense; last: boolean; onPress: () => void }) {
  const { state } = useStore();
  const nameOf = useName();
  const meId = state.meId!;
  const d = shortDate(e.date);
  const others = expensePeople(e).filter((id) => id !== meId);
  const myShare = e.shares[meId] ?? 0;
  const myPaid = e.payers[meId] ?? 0;
  const diff = myPaid - myShare;
  const payers = Object.keys(e.payers);
  const paidText = payers.length === 1 ? `${nameOf(payers[0])} paid` : `${payers.length} people paid`;
  // Who else was in it (the payer is already named).
  const rest = others.filter((id) => !(payers.length === 1 && payers[0] === id));
  const withText = rest.length ? ` · with ${namesList(rest.map(nameOf))}` : '';
  return (
    <Row
      left={
        <View style={s.dateBox}>
          <Text style={s.dateMonth}>{d.month}</Text>
          <Text style={s.dateDay}>{d.day}</Text>
        </View>
      }
      title={e.description}
      subtitle={`${paidText} ${formatMoney(e.amount, e.currency)}${withText}`}
      note={e.note}
      right={
        diff > 0 ? (
          <Mine label="you lent" amount={formatMoney(diff, e.currency)} color={colors.owed} />
        ) : diff < 0 ? (
          <Mine label="you borrowed" amount={formatMoney(-diff, e.currency)} color={colors.owe} />
        ) : (
          <Text style={s.even}>{myPaid > 0 ? "you're even" : 'not involved'}</Text>
        )
      }
      onPress={onPress}
      last={last}
    />
  );
}

function Mine({ label, amount, color }: { label: string; amount: string; color: string }) {
  return (
    <View style={{ alignItems: 'flex-end' }}>
      <Text style={{ fontSize: 11, fontWeight: '600', color }}>{label}</Text>
      <Text style={{ fontFamily: fonts.medium, fontSize: 13, color }}>{amount}</Text>
    </View>
  );
}

/** Every expense between friends that isn't in a group. */
export default function OutsideScreen({ navigation }: ScreenProps<'Outside'>) {
  const { state } = useStore();
  const items = nonGroupExpenses(state.expenses).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return (
    <Screen footer={<Button title="Add expense" onPress={() => navigation.navigate('ExpenseForm', {})} />}>
      <Text style={s.lede}>
        Expenses you share with friends outside any group. They count in your balance with each friend, and settle with
        Settle up on their page.
      </Text>
      {items.length === 0 ? (
        <List>
          <Empty title="Nothing here yet" body="Tap Add expense to split something with friends without making a group." />
        </List>
      ) : (
        <List>
          {items.map((e, i) => (
            <OutsideExpenseRow
              key={e.id}
              e={e}
              last={i === items.length - 1}
              onPress={() => navigation.navigate('ExpenseForm', { expenseId: e.id })}
            />
          ))}
        </List>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  lede: { fontSize: 14, color: colors.muted, lineHeight: 20, marginBottom: space.lg, marginHorizontal: space.xs },
  dateBox: { width: 30, alignItems: 'center' },
  dateMonth: { fontSize: 9, fontWeight: '600', color: colors.muted },
  dateDay: { fontFamily: fonts.light, fontSize: 15, color: colors.text, lineHeight: 18 },
  even: { fontSize: 11, color: colors.muted },
});
