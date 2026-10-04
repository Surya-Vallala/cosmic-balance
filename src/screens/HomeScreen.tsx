import React, { useMemo, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Libra } from '../cosmos';
import { relativeDay } from '../dates';
import { friendBalances, groupCurrencies, groupNet, nonGroupExpenses, nonZero, outsideBalances, sumTotals } from '../logic';
import { currency, formatMoney } from '../money';
import type { ScreenProps } from '../navigation';
import { IncomingFriendRequests } from '../friend-requests';
import { Bell } from '../notify-ui';
import { useStore } from '../store';
import { colors, fonts, space } from '../theme';
import type { Totals } from '../types';
import { Avatar, BalanceTag, Button, Empty, GroupBadge, List, Row, Segmented, Starfield, TotalsTag, Wordmark } from '../ui';

type Tab = 'groups' | 'friends' | 'activity';

/** "₹1,250" or "₹1,250 and $40" */
function joinAmounts(entries: [string, number][]): string {
  const parts = entries.map(([c, v]) => formatMoney(Math.abs(v), c));
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export default function HomeScreen({ navigation }: ScreenProps<'Home'>) {
  const { state, mode, userId } = useStore();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('groups');
  const meId = state.meId!;
  const me = state.people[meId];

  const [pickGroup, setPickGroup] = useState(false);
  const fb = useMemo(
    () => friendBalances(meId, state.groups, state.expenses, state.payments, state.transfers),
    [meId, state.groups, state.expenses, state.payments, state.transfers],
  );

  // What's coming to me and what I owe, per currency.
  const owedToMe: Totals = {};
  const iOwe: Totals = {};
  for (const t of Object.values(fb)) {
    for (const [c, v] of Object.entries(t)) {
      if (v > 0) owedToMe[c] = (owedToMe[c] ?? 0) + v;
      if (v < 0) iOwe[c] = (iOwe[c] ?? 0) - v;
    }
  }
  const net = nonZero(sumTotals([owedToMe, Object.fromEntries(Object.entries(iOwe).map(([c, v]) => [c, -v]))]));
  const plus = net.filter(([, v]) => v > 0);
  const minus = net.filter(([, v]) => v < 0);
  const anything = nonZero(owedToMe).length + nonZero(iOwe).length > 0;

  let headline: string;
  if (!anything) headline = "You're all settled up.";
  else if (net.length === 0) headline = "Overall, you're even.";
  else if (plus.length && minus.length) headline = `You're owed ${joinAmounts(plus)} and owe ${joinAmounts(minus)}.`;
  else if (plus.length) headline = `Overall, you're owed ${joinAmounts(plus)}.`;
  else headline = `Overall, you owe ${joinAmounts(minus)}.`;

  // The balance beam only makes sense when everything is in one currency.
  const currenciesInPlay = new Set([...Object.keys(owedToMe), ...Object.keys(iOwe)]);
  const single = currenciesInPlay.size === 1 ? [...currenciesInPlay][0] : null;
  const inn = single ? owedToMe[single] ?? 0 : 0;
  const out = single ? iOwe[single] ?? 0 : 0;

  const friendTotal = (id: string) => Object.values(fb[id] ?? {}).reduce((a, v) => a + Math.abs(v), 0);
  const unread = state.notices?.filter((n) => !n.read).length ?? 0;
  // Requests waiting for you, per group you run.
  const asking = (groupId: string) =>
    (state.joinRequests ?? []).filter((r) => r.groupId === groupId && r.personId !== meId).length;
  const friends = Object.values(state.people)
    .filter((p) => p.id !== meId && !p.requesting)
    .sort((a, b) => friendTotal(b.id) - friendTotal(a.id) || a.name.localeCompare(b.name));

  const outsideCount = nonGroupExpenses(state.expenses).length;
  // My balance across expenses outside groups, per currency.
  const outsideNet = nonZero(
    sumTotals(Object.values(outsideBalances(meId, [], [], [], nonGroupExpenses(state.expenses)))),
  );
  const addExpense = () => {
    // Pick a group, or no group (with friends); straight to the form when there's only one way.
    if (state.groups.length === 0 && friends.length === 0) navigation.navigate('GroupForm', {});
    else if (state.groups.length === 0) navigation.navigate('ExpenseForm', {});
    else setPickGroup(true);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.space }}>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: space.xxl }}>
      <View style={[s.header, { paddingTop: insets.top + space.lg }]}>
        <Starfield count={30} seed={3} />
        <Libra width={96} opacity={0.8} style={{ position: 'absolute', right: 76, top: insets.top + 4 }} />
        <View style={s.topRow}>
          <Wordmark size={17} />
          <View style={s.topActions}>
            {mode === 'cloud' ? <Bell count={unread} onPress={() => navigation.navigate('Notifications')} /> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Your profile"
              onPress={() => navigation.navigate('FriendForm', { personId: meId })}
              hitSlop={8}
            >
              <Avatar name={me?.name ?? '?'} size={34} />
            </Pressable>
          </View>
        </View>
        <Text style={s.headline}>{headline}</Text>
        {single && inn + out > 0 ? (
          <View style={{ marginTop: space.xl }}>
            <View style={s.beam}>
              {inn > 0 ? <View style={{ flex: inn, backgroundColor: colors.owed, borderRadius: 2 }} /> : null}
              {inn > 0 && out > 0 ? <View style={{ width: 4 }} /> : null}
              {out > 0 ? <View style={{ flex: out, backgroundColor: colors.owe, borderRadius: 2 }} /> : null}
            </View>
            <View style={s.beamLegend}>
              <Text style={[s.beamText, { color: colors.owed }]}>{formatMoney(inn, single)} coming to you</Text>
              <Text style={[s.beamText, { color: colors.owe, textAlign: 'right' }]}>{formatMoney(out, single)} you owe</Text>
            </View>
          </View>
        ) : null}
      </View>

      <View style={{ paddingHorizontal: space.lg }}>
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'groups', label: 'Groups' },
            { value: 'friends', label: 'Friends' },
            { value: 'activity', label: 'Activity' },
          ]}
        />

        <View style={{ marginTop: space.lg }}>
          {tab === 'groups' ? (
            state.groups.length === 0 ? (
              <>
                {outsideCount > 0 ? (
                  <List style={{ marginBottom: space.lg }}>
                    <Row
                      left={<OutsideBadge />}
                      title="Outside groups"
                      subtitle={`${outsideCount} expense${outsideCount === 1 ? '' : 's'} with friends, not in a group`}
                      right={<TotalsTag totals={Object.fromEntries(outsideNet)} />}
                      onPress={() => navigation.navigate('Outside')}
                      last
                    />
                  </List>
                ) : null}
                <Empty
                  title="No groups yet"
                  body="Make a group for a trip, your flat, or the Friday dinner gang. To split something with a friend without a group, tap Add expense."
                  action={<Button title="Start a group" onPress={() => navigation.navigate('GroupForm', {})} />}
                />
              </>
            ) : (
              <>
                <List>
                  {state.groups.map((g, i) => {
                    const count = state.expenses.filter((e) => e.groupId === g.id).length;
                    const mine = groupNet(g, state.expenses, state.payments)[meId] ?? 0;
                    const curs = groupCurrencies(g);
                    const curText = curs.length > 1 ? `, ${curs.map((c) => currency(c).symbol).join(' ')}` : '';
                    const waiting = mode === 'cloud' && g.createdBy === userId ? asking(g.id) : 0;
                    return (
                      <Row
                        key={g.id}
                        left={<GroupBadge name={g.name} />}
                        title={g.name}
                        subtitle={
                          waiting
                            ? `${waiting} asking to join · tap to let them in`
                            : `${g.memberIds.length} people, ${count} expense${count === 1 ? '' : 's'}${curText}`
                        }
                        right={<BalanceTag amount={mine} currency={g.baseCurrency} kind="group" />}
                        onPress={() => navigation.navigate('Group', { groupId: g.id })}
                        last={i === state.groups.length - 1 && outsideCount === 0}
                      />
                    );
                  })}
                  {outsideCount > 0 ? (
                    <Row
                      left={<OutsideBadge />}
                      title="Outside groups"
                      subtitle={`${outsideCount} expense${outsideCount === 1 ? '' : 's'} with friends, not in a group`}
                      right={<TotalsTag totals={Object.fromEntries(outsideNet)} />}
                      onPress={() => navigation.navigate('Outside')}
                      last
                    />
                  ) : null}
                </List>
                <Button
                  title="Start a new group"
                  variant="secondary"
                  onPress={() => navigation.navigate('GroupForm', {})}
                  style={{ marginTop: space.lg }}
                />
              </>
            )
          ) : null}

          {tab === 'friends' && mode === 'cloud' ? <IncomingFriendRequests /> : null}
          {tab === 'friends' ? (
            friends.length === 0 ? (
              <Empty
                title="No friends added"
                body="Add the people you split bills with. You can also add them while making a group."
                action={<Button title="Add a friend" onPress={() => navigation.navigate('FriendForm', {})} />}
              />
            ) : (
              <>
                <List>
                  {friends.map((p, i) => (
                    <Row
                      key={p.id}
                      left={<Avatar name={p.name} />}
                      title={p.name}
                      subtitle={
                        mode === 'cloud' && !p.userId
                          ? p.email
                            ? `Not joined yet · linked when they sign in with ${p.email}`
                            : 'Not on Cosmic Balance yet'
                          : p.upiId || undefined
                      }
                      right={<TotalsTag totals={fb[p.id] ?? {}} />}
                      onPress={() => navigation.navigate('Friend', { friendId: p.id })}
                      last={i === friends.length - 1}
                    />
                  ))}
                </List>
                <Button
                  title="Add a friend"
                  variant="secondary"
                  onPress={() => navigation.navigate('FriendForm', {})}
                  style={{ marginTop: space.lg }}
                />
              </>
            )
          ) : null}

          {tab === 'activity' ? (
            state.activity.length === 0 ? (
              <Empty title="Nothing here yet" body="Expenses, payments and group changes will show up here as they happen." />
            ) : (
              <List>
                {state.activity.slice(0, 100).map((a, i, arr) => (
                  <Row
                    key={a.id}
                    title={a.text}
                    titleLines={3}
                    subtitle={relativeDay(a.at)}
                    onPress={
                      a.groupId && state.groups.some((g) => g.id === a.groupId)
                        ? () => navigation.navigate('Group', { groupId: a.groupId! })
                        : undefined
                    }
                    last={i === arr.length - 1}
                  />
                ))}
              </List>
            )
          ) : null}
        </View>

        <Pressable
          onPress={() => navigation.navigate('About')}
          accessibilityRole="link"
          accessibilityLabel="About Cosmic Balance, developed by Tesseract Studio"
          style={s.credit}
        >
          <Text style={s.creditText}>Developed by</Text>
          <Image source={require('../../assets/tesseract-logo-light.png')} style={s.creditLogo} resizeMode="contain" />
        </Pressable>
      </View>
    </ScrollView>

      <View style={[s.bar, { paddingBottom: space.md + insets.bottom }]}>
        <View style={{ flex: 1 }}>
          <Button title="Add expense" onPress={addExpense} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Transfer money" variant="secondary" onPress={() => navigation.navigate('Transfer', {})} />
        </View>
      </View>

      <Modal visible={pickGroup} transparent animationType="slide" onRequestClose={() => setPickGroup(false)}>
        <Pressable style={s.backdrop} onPress={() => setPickGroup(false)} accessibilityLabel="Close" />
        <View style={[s.sheet, { paddingBottom: insets.bottom + space.md }]}>
          <View style={s.sheetHandle} />
          <Text style={s.sheetTitle}>Add an expense to</Text>
          <ScrollView style={{ maxHeight: 420 }}>
            {state.groups.map((g) => (
              <Row
                key={g.id}
                left={<GroupBadge name={g.name} size={36} />}
                title={g.name}
                subtitle={`${g.memberIds.length} people`}
                onPress={() => {
                  setPickGroup(false);
                  navigation.navigate('ExpenseForm', { groupId: g.id });
                }}
              />
            ))}
            <Row
              left={<OutsideBadge size={36} />}
              title="No group"
              subtitle={friends.length ? 'Pick the friends who shared it' : 'Add a friend first'}
              onPress={() => {
                setPickGroup(false);
                navigation.navigate(friends.length ? 'ExpenseForm' : 'FriendForm', {});
              }}
              last
            />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

/** Badge for expenses outside groups: two moons sharing an orbit, no planet. */
function OutsideBadge({ size = 40 }: { size?: number }) {
  const moon = size * 0.22;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: size * 0.8, height: size * 0.8, borderRadius: size, borderWidth: 1, borderColor: colors.line }} />
      <View style={{ position: 'absolute', left: size * 0.1, top: size * 0.5 - moon / 2, width: moon, height: moon, borderRadius: moon, backgroundColor: colors.owed }} />
      <View style={{ position: 'absolute', right: size * 0.1, top: size * 0.5 - moon / 2, width: moon, height: moon, borderRadius: moon, backgroundColor: colors.star }} />
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: space.xl, paddingBottom: space.xxl, overflow: 'hidden' },
  bar: {
    flexDirection: 'row',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    backgroundColor: colors.space,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  credit: { alignItems: 'center', marginTop: space.xxl, paddingVertical: space.md, gap: 8 },
  creditText: { fontSize: 11, color: colors.muted, letterSpacing: 0.4 },
  creditLogo: { width: 150, height: 25, opacity: 0.85 },
  backdrop: { flex: 1, backgroundColor: 'rgba(3, 4, 14, 0.6)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: colors.line,
    paddingTop: space.sm,
  },
  sheetHandle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.line, marginBottom: space.md },
  sheetTitle: { fontFamily: fonts.medium, fontSize: 17, color: colors.text, paddingHorizontal: space.lg, marginBottom: space.sm },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  headline: {
    fontFamily: fonts.light,
    fontSize: 32,
    lineHeight: 40,
    color: colors.text,
    marginTop: space.xxl,
    letterSpacing: -0.5,
  },
  beam: { flexDirection: 'row', height: 4 },
  beamLegend: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.sm, gap: space.md },
  beamText: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
});
