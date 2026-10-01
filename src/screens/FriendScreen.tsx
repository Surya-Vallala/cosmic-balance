import React, { useLayoutEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Supernova } from '../cosmos';
import { relativeDay } from '../dates';
import { friendBalanceByGroup, friendBalances, nonZero } from '../logic';
import { formatMoney } from '../money';
import type { ScreenProps } from '../navigation';
import { useStore } from '../store';
import { colors, fonts, space } from '../theme';
import { Avatar, BalanceTag, Button, Empty, GroupBadge, List, Row, Screen, SectionTitle } from '../ui';

export default function FriendScreen({ navigation, route }: ScreenProps<'Friend'>) {
  const { state } = useStore();
  const meId = state.meId!;
  const friend = state.people[route.params.friendId];

  useLayoutEffect(() => {
    navigation.setOptions({
      title: friend?.name ?? 'Friend',
      headerRight: () =>
        friend ? (
          <Pressable onPress={() => navigation.navigate('FriendForm', { personId: friend.id })} hitSlop={10} accessibilityRole="button">
            <Text style={s.headerLink}>Edit</Text>
          </Pressable>
        ) : null,
    });
  }, [navigation, friend]);

  if (!friend) return <Screen><Empty title="Friend not found" body="Go back to see your friends." /></Screen>;

  const overall = nonZero(friendBalances(meId, state.groups, state.expenses, state.payments, state.transfers)[friend.id] ?? {});
  const byGroup = friendBalanceByGroup(meId, friend.id, state.groups, state.expenses, state.payments);
  const sharedGroups = state.groups.filter((g) => g.memberIds.includes(friend.id));
  const between = state.transfers
    .filter((t) => (t.from === meId && t.to === friend.id) || (t.from === friend.id && t.to === meId))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const hasHistory = between.length > 0 || sharedGroups.length > 0;
  const anythingToSettle = overall.length > 0 || byGroup.length > 0;

  const lines =
    overall.length === 0
      ? [{ text: `You and ${friend.name} are settled up`, color: colors.text }]
      : overall.map(([c, v]) => ({
          text: v > 0 ? `${friend.name} owes you ${formatMoney(v, c)}` : `You owe ${friend.name} ${formatMoney(-v, c)}`,
          color: v > 0 ? colors.owed : colors.owe,
        }));

  return (
    <Screen>
      <View style={{ alignItems: 'center', marginTop: space.md }}>
        {overall.length === 0 && hasHistory ? <Supernova size={88} /> : <Avatar name={friend.name} size={72} />}
        {lines.map((l) => (
          <Text key={l.text} style={[s.headline, { color: l.color }]}>
            {l.text}
          </Text>
        ))}
        <Text style={s.caption}>Overall, across every group and outside them</Text>
        {friend.upiId ? <Text style={s.upi}>UPI: {friend.upiId}</Text> : null}
      </View>

      <View style={s.actions}>
        {anythingToSettle ? (
          <View style={{ flex: 1 }}>
            <Button title="Settle up" onPress={() => navigation.navigate('SettleAll', { friendId: friend.id })} />
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          <Button
            title="Transfer money"
            variant={anythingToSettle ? 'secondary' : 'primary'}
            onPress={() => navigation.navigate('Transfer', { from: meId, to: friend.id })}
          />
        </View>
      </View>

      {byGroup.length > 0 ? (
        <>
          <SectionTitle>In groups</SectionTitle>
          <List>
            {byGroup.map(({ group, amount }, i) => (
              <Row
                key={group.id}
                left={<GroupBadge name={group.name} size={36} />}
                title={group.name}
                right={<BalanceTag amount={amount} currency={group.baseCurrency} />}
                onPress={() => navigation.navigate('Group', { groupId: group.id })}
                last={i === byGroup.length - 1}
              />
            ))}
          </List>
        </>
      ) : null}

      <SectionTitle>Outside groups</SectionTitle>
      {between.length === 0 ? (
        <Text style={s.none}>
          No transfers yet. Use Transfer money for cash or anything you give each other outside a group.
        </Text>
      ) : (
        <List>
          {between.map((t, i) => {
            const mine = t.from === meId;
            const title =
              t.kind === 'settlement'
                ? mine
                  ? `You settled up with ${friend.name}`
                  : `${friend.name} settled up with you`
                : mine
                  ? `You gave ${friend.name}`
                  : `${friend.name} gave you`;
            return (
              <Row
                key={t.id}
                title={title}
                subtitle={[t.note, relativeDay(t.date)].filter(Boolean).join(', ')}
                right={
                  <Text
                    style={[
                      s.amount,
                      { color: t.kind === 'settlement' ? colors.textSoft : mine ? colors.owed : colors.owe },
                    ]}
                  >
                    {formatMoney(t.amount, t.currency)}
                  </Text>
                }
                onPress={() => navigation.navigate('Transfer', { transferId: t.id })}
                last={i === between.length - 1}
              />
            );
          })}
        </List>
      )}

      <SectionTitle>Groups together</SectionTitle>
      {sharedGroups.length === 0 ? (
        <Text style={s.none}>No shared groups yet.</Text>
      ) : (
        <List>
          {sharedGroups.map((g, i) => (
            <Row
              key={g.id}
              left={<GroupBadge name={g.name} size={36} />}
              title={g.name}
              subtitle={`${g.memberIds.length} people`}
              onPress={() => navigation.navigate('Group', { groupId: g.id })}
              last={i === sharedGroups.length - 1}
            />
          ))}
        </List>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  headerLink: { color: colors.star, fontSize: 16, fontWeight: '600', paddingHorizontal: 8 },
  headline: { fontFamily: fonts.light, fontSize: 24, textAlign: 'center', marginTop: space.md, lineHeight: 30 },
  caption: { fontSize: 13, color: colors.muted, marginTop: 4 },
  upi: { fontSize: 13, color: colors.muted, marginTop: 4 },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.xl },
  none: { fontSize: 14, color: colors.muted, lineHeight: 20, marginHorizontal: space.xs },
  amount: { fontFamily: fonts.medium, fontSize: 14 },
});
