import React, { useLayoutEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Supernova } from '../cosmos';
import { fromBase, groupCurrencies, groupDebts, groupSummary, toBase } from '../logic';
import { currency, formatMoney } from '../money';
import type { ScreenProps } from '../navigation';
import { useName, useStore } from '../store';
import { colors, fonts, space, tintFor } from '../theme';
import { Avatar, BalanceTag, Button, Empty, List, rateText, Screen, SectionTitle, Segmented } from '../ui';

export default function GroupSummaryScreen({ navigation, route }: ScreenProps<'GroupSummary'>) {
  const { state } = useStore();
  const nameOf = useName();
  const meId = state.meId!;
  const group = state.groups.find((g) => g.id === route.params.groupId);
  const [shown, setShown] = useState(group?.baseCurrency ?? 'INR');

  useLayoutEffect(() => {
    navigation.setOptions({ title: group ? `${group.name} summary` : 'Group summary' });
  }, [navigation, group]);

  if (!group) return <Screen><Empty title="This group was deleted" body="Go back to see your other groups." /></Screen>;

  const sum = groupSummary(group, state.expenses, state.payments);
  const currencies = groupCurrencies(group);
  const multi = currencies.length > 1;
  // Everything is worked out in the main currency; show it in whichever the user picks.
  const show = (baseAmount: number) => formatMoney(fromBase(group, baseAmount, shown), shown);
  const showSigned = (baseAmount: number) => fromBase(group, baseAmount, shown);

  // Me first, then by how much each person paid.
  const members = [...sum.members].sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : b.paid - a.paid));
  const payersForBar = members.filter((m) => m.paid > 0);
  const name = (id: string) => state.people[id]?.name ?? '?';
  const debts = groupDebts(group, state.expenses, state.payments);

  return (
    <Screen>
      {multi ? (
        <View style={{ marginBottom: space.md }}>
          <Segmented<string>
            value={shown}
            onChange={setShown}
            options={currencies.map((c) => ({ value: c, label: `Show in ${currency(c).symbol}` }))}
          />
        </View>
      ) : null}

      <Text style={s.kicker}>Total spent</Text>
      <Text style={s.total}>{show(sum.total)}</Text>
      <Text style={s.meta}>
        {sum.expenseCount} expense{sum.expenseCount === 1 ? '' : 's'} shared by {group.memberIds.length} people
      </Text>

      {multi && Object.keys(sum.byCurrency).length > 0 ? (
        <List style={{ marginTop: space.md }}>
          {currencies
            .filter((c) => sum.byCurrency[c])
            .map((c, i, arr) => (
              <View key={c} style={[s.curRow, i < arr.length - 1 && s.divider]}>
                <Text style={s.curLabel}>
                  {currency(c).name} <Text style={{ color: colors.muted }}>{c}</Text>
                </Text>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={s.curAmount}>{formatMoney(sum.byCurrency[c], c)}</Text>
                  {c !== shown ? (
                    <Text style={s.curEquiv}>{show(toBase(group, sum.byCurrency[c], c))}</Text>
                  ) : null}
                </View>
              </View>
            ))}
        </List>
      ) : null}
      {multi ? (
        <Text style={s.note}>
          Converted at the group’s rates: {currencies.slice(1).map((c) => rateText(group, c)).join(', ')}.
        </Text>
      ) : null}

      <SectionTitle>Who pays whom</SectionTitle>
      {debts.length === 0 ? (
        <View style={s.settled}>
          {sum.expenseCount > 0 ? <Supernova size={44} /> : null}
          <Text style={s.settledText}>
            {sum.expenseCount > 0 ? 'Everyone in this group is settled up.' : 'Nothing to settle yet.'}
          </Text>
        </View>
      ) : (
        <>
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
                <View key={`${d.from}-${d.to}`} style={[s.personRow, i < debts.length - 1 && s.divider]}>
                  <Avatar name={name(d.from)} size={26} />
                  <View style={{ flex: 1, marginLeft: space.md }}>
                    <Text style={s.personName}>{text}</Text>
                    <Text style={[s.debtAmount, { color: tone }]}>{show(d.amount)}</Text>
                  </View>
                  <Button
                    small
                    title="Settle"
                    variant={involvesMe ? 'primary' : 'secondary'}
                    accessibilityLabel={`Settle: ${text}`}
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
      )}

      {payersForBar.length > 0 ? (
        <>
          <SectionTitle>Who paid</SectionTitle>
          <View style={s.bar}>
            {payersForBar.map((m, i) => (
              <View
                key={m.id}
                style={{
                  flex: m.paid,
                  backgroundColor: tintFor(name(m.id)),
                  marginLeft: i === 0 ? 0 : 2,
                }}
              />
            ))}
          </View>
          <View style={s.legend}>
            {payersForBar.map((m) => (
              <View key={m.id} style={s.legendItem}>
                <View style={[s.legendDot, { backgroundColor: tintFor(name(m.id)) }]} />
                <Text style={s.legendText}>
                  {nameOf(m.id)} {Math.round((m.paid / sum.total) * 100)}%
                </Text>
              </View>
            ))}
          </View>
        </>
      ) : null}

      <SectionTitle>Each person</SectionTitle>
      <List>
        {members.map((m, i) => (
          <View key={m.id} style={[s.personRow, i < members.length - 1 && s.divider]}>
            <Avatar name={name(m.id)} size={26} />
            <View style={{ flex: 1, marginLeft: space.md, minWidth: 0 }}>
              <Text style={s.personName}>{nameOf(m.id)}</Text>
              <View style={s.stats}>
                <Stat label="Paid" value={show(m.paid)} />
                <Stat label="Share" value={show(m.share)} />
                {m.sent > 0 ? <Stat label="Settled" value={show(m.sent)} /> : null}
                {m.received > 0 ? <Stat label="Received" value={show(m.received)} /> : null}
              </View>
            </View>
            <BalanceTag amount={showSigned(m.balance)} currency={shown} kind="member" />
          </View>
        ))}
      </List>
      <Text style={s.note}>
        Paid is what each person put in for expenses. Share is what their part of those expenses cost. The balance also
        counts settle-up payments.
      </Text>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={s.statValue}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  settled: { alignItems: 'center', gap: space.xs, paddingVertical: space.sm },
  settledText: { fontSize: 13, color: colors.textSoft },
  debtAmount: { fontFamily: fonts.medium, fontSize: 13 },
  kicker: { fontSize: 12, fontWeight: '600', color: colors.muted },
  total: { fontFamily: fonts.light, fontSize: 26, lineHeight: 32, color: colors.text, letterSpacing: -0.5 },
  meta: { fontSize: 12, color: colors.muted, marginTop: 1 },
  curRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 7, paddingHorizontal: space.lg },
  curLabel: { fontSize: 14, color: colors.text },
  curAmount: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  curEquiv: { fontSize: 12, color: colors.muted, marginTop: 1 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  note: { fontSize: 12, color: colors.muted, marginTop: space.sm, marginHorizontal: space.xs, lineHeight: 17 },
  bar: { flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.md, rowGap: 2, marginTop: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 12, color: colors.textSoft },
  personRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, paddingHorizontal: space.lg },
  personName: { fontSize: 14, fontWeight: '600', color: colors.text },
  stats: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.md, rowGap: 2, marginTop: 2 },
  statLabel: { fontSize: 10, color: colors.muted, fontWeight: '600' },
  statValue: { fontFamily: fonts.medium, fontSize: 12, color: colors.textSoft },
});
