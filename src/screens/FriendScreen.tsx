import React, { useLayoutEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Supernova } from '../cosmos';
import { relativeDay } from '../dates';
import { shareNote, ShareLink, useInviteLinks } from '../invites';
import { canRemoveFriend, friendBalanceByGroup, friendBalances, nonZero } from '../logic';
import { formatMoney } from '../money';
import type { ScreenProps } from '../navigation';
import { useStore } from '../store';
import { colors, fonts, space } from '../theme';
import { Avatar, BalanceTag, Button, ConfirmButton, Empty, GroupBadge, List, Row, Screen, SectionTitle } from '../ui';

export default function FriendScreen({ navigation, route }: ScreenProps<'Friend'>) {
  const { state, mode, dispatch, userId } = useStore();
  const meId = state.meId!;
  const friend = state.people[route.params.friendId];
  const notJoined = mode === 'cloud' && !!friend && !friend.userId;
  const invites = useInviteLinks(notJoined && friend ? [friend] : []);
  const [inviteNote, setInviteNote] = useState<string | null>(null);

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

  if (!friend || friend.id === meId) {
    return (
      <Screen>
        <Empty title="Not in your friends" body="They may have been removed. Go back to see your friends." />
      </Screen>
    );
  }

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
        {mode === 'cloud' && !friend.userId ? (
          <Text style={s.upi}>
            {friend.email
              ? `Not on Cosmic Balance yet. Linked automatically when they sign in with ${friend.email}.`
              : 'Not on Cosmic Balance yet. Send them their invite link.'}
          </Text>
        ) : null}
      </View>

      {notJoined && invites.unavailable(friend.id) ? (
        <Text style={[s.inviteNote, { textAlign: 'center', marginTop: space.lg }]}>
          {friend.name} is also in groups you’re not in, so only whoever added {friend.name} can send their invite.
        </Text>
      ) : notJoined ? (
        <View style={{ marginTop: space.lg }}>
          <SectionTitle>{`Invite ${friend.name}`}</SectionTitle>
          <ShareLink
            link={invites.link(friend.id)}
            accessibilityLabel={`Share ${friend.name}’s invite link`}
            onShare={() => {
              const l = invites.link(friend.id);
              invites.share(friend)?.then((r) => setInviteNote(l ? shareNote(r, l) : null));
            }}
          />
          <Text style={s.inviteNote}>
            {invites.error ??
              inviteNote ??
              `Share opens your phone’s share menu: pick WhatsApp, then ${friend.name}’s chat. This link is only for ${friend.name}: opening it and signing in with Google makes them ${friend.name} here.`}
          </Text>
        </View>
      ) : null}

      <View style={s.actions}>
        {anythingToSettle ? (
          <View style={{ flex: 1 }}>
            <Button title="Settle up" onPress={() => navigation.navigate('SettleAll', { friendId: friend.id })} />
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          <Button
            title="Transfer money"
            variant={anythingToSettle || notJoined ? 'secondary' : 'primary'}
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

      <RemoveFriend
        check={canRemoveFriend(state, friend.id, userId, mode === 'cloud')}
        name={friend.name}
        onRemove={() => {
          dispatch({ type: 'removeFriend', id: friend.id });
          navigation.popToTop();
        }}
      />
    </Screen>
  );
}

function RemoveFriend({
  check,
  name,
  onRemove,
}: {
  check: ReturnType<typeof canRemoveFriend>;
  name: string;
  onRemove: () => void;
}) {
  return (
    <View style={{ marginTop: space.xxl }}>
      {check.ok ? (
        <>
          <ConfirmButton title={`Remove ${name}`} confirmTitle={`Tap again to remove ${name}`} onConfirm={onRemove} />
          <Text style={s.removeNote}>
            {[
              `You’re settled up, so you can remove ${name} from your friends.`,
              check.leaves.length
                ? `They’ll also leave ${check.leaves.map((g) => g.name).join(', ')}.`
                : '',
              'Their account isn’t affected.',
            ]
              .filter(Boolean)
              .join(' ')}
          </Text>
        </>
      ) : (
        <Text style={s.removeNote}>{check.reason}</Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  headerLink: { color: colors.star, fontSize: 16, fontWeight: '600', paddingHorizontal: 8 },
  headline: { fontFamily: fonts.light, fontSize: 24, textAlign: 'center', marginTop: space.md, lineHeight: 30 },
  caption: { fontSize: 13, color: colors.muted, marginTop: 4 },
  inviteNote: { fontSize: 12, color: colors.muted, marginTop: space.sm, marginHorizontal: space.xs, lineHeight: 16 },
  removeNote: { fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: space.sm, lineHeight: 17 },
  upi: { fontSize: 13, color: colors.muted, marginTop: 4, textAlign: 'center', lineHeight: 18 },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.xl },
  none: { fontSize: 14, color: colors.muted, lineHeight: 20, marginHorizontal: space.xs },
  amount: { fontFamily: fonts.medium, fontSize: 14 },
});
