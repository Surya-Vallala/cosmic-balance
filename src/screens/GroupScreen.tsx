import React, { useLayoutEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { approveJoinRequest, declineJoinRequest } from '../cloud/api';
import { inviteLink } from '../cloud/config';
import { shareNote, ShareLink, useInviteLinks } from '../invites';
import { groupLinkMessage } from '../messages';
import { shortDate } from '../dates';
import { groupCurrencies, groupDebts, groupNet, groupSummary } from '../logic';
import { formatMoney } from '../money';
import type { ScreenProps } from '../navigation';
import { shareText } from '../share';
import { useName, useStore } from '../store';
import { colors, fonts, space } from '../theme';
import type { JoinRequest, Person } from '../types';
import { Avatar, Button, Empty, equivalents, List, rateText, Row, Screen, SectionTitle, styles as ui } from '../ui';

export default function GroupScreen({ navigation, route }: ScreenProps<'Group'>) {
  const { state, mode, userId, refresh } = useStore();
  const nameOf = useName();
  const insets = useSafeAreaInsets();
  const [inviteNote, setInviteNote] = useState<string | null>(null);
  const [memberNote, setMemberNote] = useState<string | null>(null);
  const [showLink, setShowLink] = useState(false);
  const [approving, setApproving] = useState<JoinRequest | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const meId = state.meId!;
  const group = state.groups.find((g) => g.id === route.params.groupId);
  // Members who haven't joined yet, to send each their own invite link.
  const waiting: Person[] =
    mode === 'cloud' && group
      ? group.memberIds
          .filter((id) => id !== meId)
          .map((id) => state.people[id])
          .filter((p): p is Person => !!p && !p.userId)
      : [];
  const invites = useInviteLinks(waiting);
  // People asking to join through the group's link (only whoever created the group lets them in).
  const letsPeopleIn = mode === 'cloud' && !!group && (group.createdBy === userId || !group.createdBy);
  const requests = letsPeopleIn ? (state.joinRequests ?? []).filter((r) => r.groupId === group!.id && r.personId !== meId) : [];
  const owner = group?.createdBy ? Object.values(state.people).find((p) => p.userId === group.createdBy) : undefined;

  const decide = async (r: JoinRequest, approve: boolean, as: string | null = null) => {
    setBusy(r.id);
    setRequestError(null);
    setApproving(null);
    try {
      if (approve) await approveJoinRequest(r.id, as);
      else await declineJoinRequest(r.id);
      await refresh();
    } catch (e) {
      setRequestError(e instanceof Error ? e.message : 'That didn’t work. Try again.');
    }
    setBusy(null);
  };
  // Names someone could be let in as (not ones also in groups you aren't in).
  const claimable = waiting.filter((p) => !invites.unavailable(p.id));
  const approve = (r: JoinRequest) => {
    // If they may already be in the group under a name you added, ask which.
    if (claimable.length) setApproving(r);
    else void decide(r, true);
  };

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
            title="Invite friends"
            subtitle="Share the group’s link on WhatsApp"
            right={<Text style={[s.chevron, showLink && { transform: [{ rotate: '90deg' }] }]}>›</Text>}
            onPress={() => setShowLink((v) => !v)}
          />
        ) : null}
        <Row
          title="Group summary"
          subtitle={debts.length ? 'Who pays whom, and what each person paid and owes' : 'Total spending, and what each person paid and owes'}
          right={<Text style={s.chevron}>›</Text>}
          onPress={() => navigation.navigate('GroupSummary', { groupId: group.id })}
          last
        />
      </List>
      {mode === 'cloud' && group.inviteCode && showLink ? (
        <View style={{ marginTop: space.md }}>
          <ShareLink
            link={inviteLink(group.inviteCode)}
            accessibilityLabel="Share the group link"
            onShare={async () => {
              const l = inviteLink(group.inviteCode!);
              setInviteNote(shareNote(await shareText(groupLinkMessage({ group: group.name, link: l })), l));
            }}
          />
          <Text style={s.note}>
            {inviteNote ??
              (letsPeopleIn
                ? 'Share opens your phone’s share menu: pick WhatsApp, then a friend or a whole chat. Anyone who opens the link can ask to join, and you choose who to let in.'
                : `Share opens your phone’s share menu: pick WhatsApp, then a friend or a whole chat. Anyone who opens the link can ask to join, and ${owner?.name ?? 'whoever created the group'} chooses who to let in.`)}
          </Text>
        </View>
      ) : null}

      {requests.length > 0 ? (
        <>
          <SectionTitle>Asking to join</SectionTitle>
          <List>
            {requests.map((r, i) => {
              const p = state.people[r.personId];
              return (
                <View key={r.id} style={[s.debtRow, i < requests.length - 1 && s.divider]}>
                  <Avatar name={p?.name ?? '?'} size={32} />
                  <View style={{ flex: 1, marginLeft: space.md, marginRight: space.sm }}>
                    <Text style={s.debtText}>{p?.name ?? 'Someone'}</Text>
                    <Text style={s.waitingNote}>{busy === r.id ? 'Saving…' : p?.email ?? 'Opened the group’s link'}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: space.xs }}>
                    <Button
                      small
                      title="Decline"
                      variant="ghost"
                      disabled={!!busy}
                      accessibilityLabel={`Decline ${p?.name ?? 'this request'}`}
                      onPress={() => decide(r, false)}
                    />
                    <Button
                      small
                      title="Let in"
                      disabled={!!busy}
                      accessibilityLabel={`Let ${p?.name ?? 'them'} in`}
                      onPress={() => approve(r)}
                    />
                  </View>
                </View>
              );
            })}
          </List>
          <Text style={s.note}>
            {requestError ?? 'They opened this group’s link. Only people you let in can see the group.'}
          </Text>
        </>
      ) : null}

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
                    {invites.unavailable(p.id)
                      ? 'Also in groups you’re not in: whoever added them sends their invite'
                      : p.email
                        ? `Joins by signing in with ${p.email}, or share their link`
                        : 'Share their own invite link'}
                  </Text>
                </View>
                <Button
                  small
                  title="Share"
                  variant="secondary"
                  disabled={!invites.ready(p.id)}
                  accessibilityLabel={`Share ${p.name}’s invite link`}
                  onPress={() => {
                    const l = invites.link(p.id);
                    invites.share(p)?.then((r) => setMemberNote(l ? shareNote(r, l) : null));
                  }}
                />
              </View>
            ))}
          </List>
          <Text style={s.note}>
            {invites.error ??
              memberNote ??
              'Each friend gets their own link: no approval needed. When they open it and sign in with Google, everything recorded for them becomes theirs.'}
          </Text>
        </>
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

      <Modal visible={!!approving} transparent animationType="slide" onRequestClose={() => setApproving(null)}>
        <Pressable style={ui.backdrop} onPress={() => setApproving(null)} accessibilityLabel="Close" />
        <View style={[ui.sheet, { paddingBottom: insets.bottom + space.md }]}>
          <View style={ui.sheetHandle} />
          <Text style={ui.sheetTitle}>Let {approving ? state.people[approving.personId]?.name ?? 'them' : 'them'} in as</Text>
          <Text style={[ui.hint, { marginTop: 0, paddingHorizontal: space.lg, marginBottom: space.sm }]}>
            If you already added them by name, pick that name: everything recorded for it becomes theirs.
          </Text>
          <ScrollView style={{ maxHeight: 360 }}>
            {claimable.map((p) => (
              <Row
                key={p.id}
                left={<Avatar name={p.name} size={36} />}
                title={`They’re ${p.name}`}
                onPress={() => approving && decide(approving, true, p.id)}
              />
            ))}
            <Row
              title="Someone new"
              subtitle="Add them as a new member"
              onPress={() => approving && decide(approving, true)}
              last
            />
          </ScrollView>
        </View>
      </Modal>
    </Screen>
  );
}

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
