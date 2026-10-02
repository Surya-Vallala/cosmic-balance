import React, { useLayoutEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { inviteLink } from '../cloud/config';
import { useWhatsAppInvites } from '../invites';
import { Supernova } from '../cosmos';
import { shortDate } from '../dates';
import { groupCurrencies, groupDebts, groupNet, groupSummary } from '../logic';
import { formatMoney } from '../money';
import type { ScreenProps } from '../navigation';
import { shareText } from '../share';
import { useName, useStore } from '../store';
import { colors, fonts, space } from '../theme';
import type { Person } from '../types';
import { Avatar, Button, Empty, equivalents, List, rateText, Row, Screen, SectionTitle } from '../ui';

export default function GroupScreen({ navigation, route }: ScreenProps<'Group'>) {
  const { state, mode } = useStore();
  const nameOf = useName();
  const [inviteNote, setInviteNote] = useState<string | null>(null);
  const meId = state.meId!;
  const group = state.groups.find((g) => g.id === route.params.groupId);
  // Members who haven't joined yet, to invite one by one on WhatsApp.
  const waiting: Person[] =
    mode === 'cloud' && group
      ? group.memberIds
          .filter((id) => id !== meId)
          .map((id) => state.people[id])
          .filter((p): p is Person => !!p && !p.userId)
      : [];
  const invites = useWhatsAppInvites(waiting);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: group?.name ?? 'Group',
      headerRight: () =>
        group ? (
          <Pressable onPress={() => navigation.navigate('GroupForm', { groupId: group.id })} hitSlop={10} accessibilityRole="button">
            <Text style={s.headerLink}>Edit</Text>
          </Pressable>
        ) : null,
    });
  }, [navigation, group]);

  if (!group) {
    return (
      <Screen>
        <Empty title="This group was deleted" body="Go back to see your other groups." />
      </Screen>
    );
  }

  const base = group.baseCurrency;
  const multi = groupCurrencies(group).length > 1;
  const expenses = state.expenses.filter((e) => e.groupId === group.id);
  const payments = state.payments.filter((p) => p.groupId === group.id);
  const debts = groupDebts(group, state.expenses, state.payments);
  const myNet = groupNet(group, state.expenses, state.payments)[meId] ?? 0;
  const total = groupSummary(group, state.expenses, state.payments).total;

  type Item =
    | { kind: 'expense'; date: string; id: string; e: (typeof expenses)[number] }
    | { kind: 'payment'; date: string; id: string; p: (typeof payments)[number] };
  const items: Item[] = [
    ...expenses.map((e) => ({ kind: 'expense' as const, date: e.date, id: e.id, e })),
    ...payments.map((p) => ({ kind: 'payment' as const, date: p.date, id: p.id, p })),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const summary =
    myNet > 0
      ? `You're owed ${formatMoney(myNet, base)}`
      : myNet < 0
        ? `You owe ${formatMoney(-myNet, base)}`
        : expenses.length
          ? "You're settled up"
          : 'No expenses yet';

  return (
    <Screen
      footer={
        <>
          <Button title="Add expense" onPress={() => navigation.navigate('ExpenseForm', { groupId: group.id })} />
          <Button
            title="Settle up"
            variant="secondary"
            disabled={debts.length === 0}
            onPress={() => {
              const mine = debts.find((d) => d.from === meId) ?? debts.find((d) => d.to === meId) ?? debts[0];
              navigation.navigate('SettleUp', { groupId: group.id, from: mine?.from, to: mine?.to, amount: mine?.amount });
            }}
          />
        </>
      }
    >
      <Text style={[s.summary, { color: myNet > 0 ? colors.owed : myNet < 0 ? colors.owe : colors.text }]}>{summary}</Text>
      {multi && myNet !== 0 ? <Text style={s.equiv}>or {equivalents(group, myNet)}</Text> : null}
      <Text style={s.meta}>
        {group.memberIds.length} people, {formatMoney(total, base)} spent
        {multi ? `. ${groupCurrencies(group).slice(1).map((c) => rateText(group, c)).join(', ')}` : ''}
      </Text>

      <List style={{ marginTop: space.lg }}>
        {mode === 'cloud' && group.inviteCode ? (
          <Row
            title="Share the group link"
            subtitle={inviteNote ?? 'For friends you haven’t added yet. Anyone with the link can join this group.'}
            right={<Text style={s.chevron}>›</Text>}
            onPress={async () => {
              const result = await shareText(
                `Join “${group.name}” on Cosmic Khaata so we can split our expenses: ${inviteLink(group.inviteCode!)}`,
              );
              setInviteNote(
                result === 'copied'
                  ? 'Link copied. Paste it into WhatsApp or any chat.'
                  : result === 'failed'
                    ? `Copy this link: ${inviteLink(group.inviteCode!)}`
                    : null,
              );
            }}
          />
        ) : null}
        <Row
          title="Group summary"
          subtitle="Total spending, and what each person paid, used and owes"
          right={<Text style={s.chevron}>›</Text>}
          onPress={() => navigation.navigate('GroupSummary', { groupId: group.id })}
          last
        />
      </List>

      {waiting.length > 0 ? (
        <>
          <SectionTitle>Not joined yet</SectionTitle>
          <List>
            {waiting.map((p, i) => (
              <View key={p.id} style={[s.debtRow, i < waiting.length - 1 && s.divider]}>
                <Avatar name={p.name} size={32} />
                <View style={{ flex: 1, marginLeft: space.md, marginRight: space.sm }}>
                  <Text style={s.debtText}>{p.name}</Text>
                  <Text style={s.waitingNote}>
                    {p.email
                      ? `Joins by signing in with ${p.email}, or send the invite`
                      : 'Send their invite on WhatsApp'}
                  </Text>
                </View>
                <Button
                  small
                  title="WhatsApp"
                  variant="secondary"
                  disabled={!invites.ready(p.id)}
                  accessibilityLabel={`Invite ${p.name} on WhatsApp`}
                  onPress={() => invites.invite(p)}
                />
              </View>
            ))}
          </List>
          <Text style={s.note}>
            {invites.error ??
              'Each friend gets their own link. When they open it and sign in with Google, everything recorded for them becomes theirs.'}
          </Text>
        </>
      ) : null}

      {debts.length > 0 ? (
        <>
          <SectionTitle>Who pays whom</SectionTitle>
          <List>
            {debts.map((d, i) => {
              const involvesMe = d.from === meId || d.to === meId;
              const text =
                d.from === meId
                  ? `You pay ${nameOf(d.to)}`
                  : d.to === meId
                    ? `${nameOf(d.from)} pays you`
                    : `${nameOf(d.from)} pays ${nameOf(d.to)}`;
              const tone = d.from === meId ? colors.owe : d.to === meId ? colors.owed : colors.textSoft;
              return (
                <View key={`${d.from}-${d.to}`} style={[s.debtRow, i < debts.length - 1 && s.divider]}>
                  <Avatar name={state.people[d.from]?.name ?? '?'} size={32} />
                  <View style={{ flex: 1, marginLeft: space.md }}>
                    <Text style={s.debtText}>{text}</Text>
                    <Text style={[s.debtAmount, { color: tone }]}>{formatMoney(d.amount, base)}</Text>
                    {multi ? <Text style={s.debtEquiv}>or {equivalents(group, d.amount)}</Text> : null}
                  </View>
                  <Button
                    small
                    title="Settle"
                    variant={involvesMe ? 'primary' : 'secondary'}
                    onPress={() =>
                      navigation.navigate('SettleUp', { groupId: group.id, from: d.from, to: d.to, amount: d.amount })
                    }
                  />
                </View>
              );
            })}
          </List>
          {group.simplifyDebts ? (
            <Text style={s.note}>Debts are simplified so the group needs the fewest payments.</Text>
          ) : null}
        </>
      ) : null}

      {debts.length === 0 && expenses.length > 0 ? (
        <View style={s.settled}>
          <Supernova size={72} />
          <Text style={s.settledText}>Everyone in this group is settled up.</Text>
        </View>
      ) : null}

      <SectionTitle>Expenses and payments</SectionTitle>
      {items.length === 0 ? (
        <List>
          <Empty title="Add the first expense" body="Tap Add expense below when someone pays for the group." />
        </List>
      ) : (
        <List>
          {items.map((it, i) => {
            const d = shortDate(it.date);
            const dateBox = (
              <View style={s.dateBox}>
                <Text style={s.dateMonth}>{d.month}</Text>
                <Text style={s.dateDay}>{d.day}</Text>
              </View>
            );
            const last = i === items.length - 1;
            if (it.kind === 'payment') {
              const p = it.p;
              return (
                <Row
                  key={it.id}
                  left={dateBox}
                  title={`${nameOf(p.from)} paid ${p.to === meId ? 'you' : nameOf(p.to)}`}
                  subtitle={p.settlementId ? 'Part of an overall settle-up' : 'Payment'}
                  right={<Text style={s.payAmount}>{formatMoney(p.amount, p.currency)}</Text>}
                  onPress={() => navigation.navigate('SettleUp', { groupId: group.id, paymentId: p.id })}
                  last={last}
                />
              );
            }
            const e = it.e;
            const myShare = e.shares[meId] ?? 0;
            const myPaid = e.payers[meId] ?? 0;
            const diff = myPaid - myShare;
            let right: React.ReactNode;
            if (diff > 0) right = <Mine label="you lent" amount={formatMoney(diff, e.currency)} color={colors.owed} />;
            else if (diff < 0) right = <Mine label="you borrowed" amount={formatMoney(-diff, e.currency)} color={colors.owe} />;
            else right = <Text style={s.notInvolved}>{myPaid > 0 ? "you're even" : 'not involved'}</Text>;
            return (
              <Row
                key={it.id}
                left={dateBox}
                title={e.description}
                subtitle={`${payersLabel(Object.keys(e.payers), meId, nameOf)} paid ${formatMoney(e.amount, e.currency)}`}
                right={right}
                onPress={() => navigation.navigate('ExpenseForm', { groupId: group.id, expenseId: e.id })}
                last={last}
              />
            );
          })}
        </List>
      )}
    </Screen>
  );
}

/** Who still needs to accept the invite. */
/** "Ravi", "You and Ravi", or "3 people" for an expense's payers. */
function payersLabel(ids: string[], meId: string, nameOf: (id: string) => string): string {
  const sorted = [...ids].sort((a, b) => (a === meId ? -1 : b === meId ? 1 : 0));
  if (sorted.length === 1) return nameOf(sorted[0]);
  if (sorted.length === 2) return `${nameOf(sorted[0])} and ${nameOf(sorted[1])}`;
  return `${sorted.length} people`;
}

function Mine({ label, amount, color }: { label: string; amount: string; color: string }) {
  return (
    <View style={{ alignItems: 'flex-end' }}>
      <Text style={{ fontSize: 12, fontWeight: '600', color }}>{label}</Text>
      <Text style={{ fontFamily: fonts.medium, fontSize: 14, color }}>{amount}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  headerLink: { color: colors.star, fontSize: 16, fontWeight: '600', paddingHorizontal: 8 },
  summary: { fontFamily: fonts.light, fontSize: 28, lineHeight: 34, letterSpacing: -0.4 },
  equiv: { fontSize: 15, color: colors.textSoft, marginTop: 2 },
  meta: { fontSize: 13, color: colors.muted, marginTop: space.sm, lineHeight: 18 },
  chevron: { fontSize: 24, color: colors.muted, lineHeight: 26 },
  debtRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: space.lg },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  debtText: { fontSize: 15, color: colors.text },
  waitingNote: { fontSize: 12, color: colors.muted, marginTop: 2, lineHeight: 16 },
  debtAmount: { fontFamily: fonts.medium, fontSize: 16, marginTop: 2 },
  debtEquiv: { fontSize: 12, color: colors.muted, marginTop: 1 },
  note: { fontSize: 12, color: colors.muted, marginTop: space.sm, marginHorizontal: space.xs },
  dateBox: { width: 38, alignItems: 'center' },
  dateMonth: { fontSize: 11, fontWeight: '600', color: colors.muted },
  dateDay: { fontFamily: fonts.light, fontSize: 20, color: colors.text, lineHeight: 24 },
  payAmount: { fontFamily: fonts.medium, fontSize: 14, color: colors.textSoft },
  notInvolved: { fontSize: 12, color: colors.muted },
  settled: { alignItems: 'center', marginTop: space.xl, gap: space.sm },
  settledText: { fontSize: 14, color: colors.textSoft },
});
