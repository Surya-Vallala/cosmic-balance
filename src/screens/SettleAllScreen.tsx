import React, { useEffect, useLayoutEffect, useState } from 'react';
import { Linking, Share, StyleSheet, Text, View } from 'react-native';
import { Pulsar, Supernova } from '../cosmos';
import { friendBalances, nonZero, planOverallSettlement } from '../logic';
import { currency as currencyInfo, formatMoney, paiseToDecimalString } from '../money';
import type { ScreenProps } from '../navigation';
import { uid, useStore } from '../store';
import { colors, fonts, space } from '../theme';
import type { Payment } from '../types';
import { BalanceTag, Button, Empty, GroupBadge, List, Row, Screen, Segmented, styles as ui } from '../ui';

export default function SettleAllScreen({ navigation, route }: ScreenProps<'SettleAll'>) {
  const { state, dispatch } = useStore();
  const meId = state.meId!;
  const friend = state.people[route.params.friendId];
  const [done, setDone] = useState(false);

  // Currencies with anything to settle, in groups or outside them.
  const inPlay = new Set<string>();
  for (const g of state.groups) if (g.memberIds.includes(meId) && g.memberIds.includes(route.params.friendId)) inPlay.add(g.baseCurrency);
  for (const t of state.transfers) if ([t.from, t.to].includes(route.params.friendId)) inPlay.add(t.currency);
  const fb = friendBalances(meId, state.groups, state.expenses, state.payments, state.transfers)[route.params.friendId] ?? {};
  for (const [c] of nonZero(fb)) inPlay.add(c);
  const currencies = [...inPlay].filter((c) => {
    const plan = planOverallSettlement(meId, route.params.friendId, c, state.groups, state.expenses, state.payments, state.transfers);
    return plan.total !== 0 || plan.groups.length > 0;
  });
  const [cur, setCur] = useState(route.params.currency ?? currencies[0] ?? 'INR');

  useLayoutEffect(() => {
    navigation.setOptions({ title: friend ? `Settle up with ${friend.name}` : 'Settle up' });
  }, [navigation, friend]);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => navigation.goBack(), 1400);
    return () => clearTimeout(t);
  }, [done, navigation]);

  if (!friend) return <Screen><Empty title="Friend not found" body="Go back to see your friends." /></Screen>;

  if (done) {
    return (
      <View style={s.done}>
        <Supernova size={160} burst />
        <Text style={s.doneText}>Settled up with {friend.name}</Text>
      </View>
    );
  }

  if (currencies.length === 0) {
    return (
      <Screen>
        <Empty title="Nothing to settle" body={`You and ${friend.name} are even everywhere.`} />
      </Screen>
    );
  }

  const plan = planOverallSettlement(meId, friend.id, cur, state.groups, state.expenses, state.payments, state.transfers);
  const theyPay = plan.total > 0;
  const amount = Math.abs(plan.total);
  const money = (v: number) => formatMoney(v, cur);
  const payer = theyPay ? friend.id : meId;
  const receiver = theyPay ? meId : friend.id;

  const headline =
    plan.total === 0
      ? `You and ${friend.name} are even overall`
      : theyPay
        ? `${friend.name} pays you ${money(amount)}`
        : `You pay ${friend.name} ${money(amount)}`;

  const record = () => {
    const settlementId = uid();
    const now = new Date().toISOString();
    const payments: Payment[] = plan.groupPayments.map((p) => ({
      id: uid(),
      groupId: p.groupId,
      from: p.from,
      to: p.to,
      currency: cur,
      amount: p.amount,
      baseAmount: p.amount,
      date: now,
      settlementId,
    }));
    dispatch({
      type: 'settleOverall',
      settlement: { id: settlementId, kind: 'settlement', from: payer, to: receiver, currency: cur, amount, date: now, createdAt: now },
      payments,
    });
    setDone(true);
  };

  const payWithUpi = () => {
    if (!friend.upiId) return;
    const params = [
      `pa=${encodeURIComponent(friend.upiId)}`,
      `pn=${encodeURIComponent(friend.name)}`,
      `am=${paiseToDecimalString(amount)}`,
      'cu=INR',
      `tn=${encodeURIComponent('Settle up (Cosmic Balance)')}`,
    ].join('&');
    Linking.openURL(`upi://pay?${params}`).catch(() => {});
  };

  const remind = async () => {
    const me = state.people[meId];
    const upiLine = me?.upiId && cur === 'INR' ? ` You can pay me on UPI at ${me.upiId}.` : '';
    try {
      await Share.share({
        message: `Hi ${friend.name}, adding up all our groups and everything else, you owe me ${money(amount)} overall.${upiLine}`,
      });
    } catch {
      // cancelled
    }
  };

  return (
    <Screen
      footer={
        <Button
          title={plan.total === 0 ? 'Mark everything as settled' : `Record ${money(amount)} settle-up`}
          onPress={record}
        />
      }
    >
      {currencies.length > 1 ? (
        <View style={{ marginBottom: space.md }}>
          <Segmented<string>
            value={cur}
            onChange={setCur}
            options={currencies.map((c) => ({ value: c, label: `${currencyInfo(c).symbol} ${c}` }))}
          />
          <Text style={ui.hint}>Groups in different main currencies are settled separately.</Text>
        </View>
      ) : null}

      <Text style={[s.headline, { color: plan.total > 0 ? colors.owed : plan.total < 0 ? colors.owe : colors.text }]}>
        {headline}
      </Text>
      <Text style={s.sub}>Adding up every group you share and money outside groups.</Text>

      <List style={{ marginTop: space.md }}>
        {plan.groups.map(({ group, amount: a }) => (
          <Row key={group.id} left={<GroupBadge name={group.name} size={26} />} title={group.name} right={<BalanceTag amount={a} currency={cur} />} />
        ))}
        {plan.outside !== 0 ? (
          <Row title="Outside groups" subtitle="Transfers and cash between you" right={<BalanceTag amount={plan.outside} currency={cur} />} />
        ) : null}
        <View style={s.totalRow}>
          <Text style={s.totalLabel}>Overall</Text>
          <BalanceTag amount={plan.total} currency={cur} />
        </View>
      </List>

      <Text style={s.explain}>
        {plan.total === 0
          ? `No money needs to change hands. Recording this marks every group with ${friend.name} as settled.`
          : `Once ${theyPay ? friend.name + ' pays you' : 'you pay ' + friend.name} ${money(amount)}, record it here. Every group above will then show you and ${friend.name} as settled.`}
      </Text>

      {!theyPay && plan.total !== 0 && cur === 'INR' && friend.upiId ? (
        <View style={s.panel}>
          <Text style={s.panelTitle}>Pay {friend.name} with UPI</Text>
          <Text style={s.panelBody}>Opens your UPI app with {friend.upiId} and {money(amount)} filled in.</Text>
          <Button title={`Pay ${money(amount)} in UPI app`} variant="secondary" onPress={payWithUpi} style={{ marginTop: space.md }} />
        </View>
      ) : null}

      {theyPay ? (
        <View style={s.panel}>
          <View style={s.panelHead}>
            <Pulsar size={30} />
            <Text style={s.panelTitle}>Waiting on {friend.name}?</Text>
          </View>
          <Text style={s.panelBody}>Send them the overall figure on WhatsApp or any other app.</Text>
          <Button title="Send a reminder" variant="secondary" onPress={remind} style={{ marginTop: space.md }} />
        </View>
      ) : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  headline: { fontFamily: fonts.light, fontSize: 21, lineHeight: 26, letterSpacing: -0.4 },
  sub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: space.lg,
    backgroundColor: colors.raised,
  },
  totalLabel: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  explain: { fontSize: 12, color: colors.muted, marginTop: space.sm, lineHeight: 17, marginHorizontal: space.xs },
  panel: {
    marginTop: space.lg,
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    padding: space.md,
  },
  panelTitle: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  panelBody: { fontSize: 13, color: colors.textSoft, marginTop: 2, lineHeight: 18 },
  panelHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  done: { flex: 1, backgroundColor: colors.space, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  doneText: { fontFamily: fonts.light, fontSize: 24, color: colors.text, marginTop: space.xl, textAlign: 'center' },
});
