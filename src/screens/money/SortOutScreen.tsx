// To sort out: things in Split where money of yours moved (a friend recorded
// paying you back, an expense you paid recorded on another phone…) and Money
// doesn't know which account. Say which, and your accounts stay right. Only
// you see your answers.

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { relativeTime } from '../../dates';
import { formatMoney } from '../../money';
import type { ScreenProps } from '../../navigation';
import { sortedAccounts } from '../../pfm/logic';
import { useMaybeMoney } from '../../pfm/store';
import { Icon } from '../../pfm/ui';
import { useStore } from '../../store';
import { colors, fonts, space } from '../../theme';
import type { Id } from '../../types';
import { Avatar, Button, Empty, Screen, styles as ui } from '../../ui';

export default function SortOutScreen({ navigation }: ScreenProps<'SortOut'>) {
  const money = useMaybeMoney();
  const { state } = useStore();
  const meId = state.meId;
  // Cards you answer stay for this visit (so they don't vanish under your finger).
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());

  if (!money || !money.on) {
    return (
      <Screen>
        <Empty title="Money is off" body="Turn Money on from your profile to keep track of your own accounts." />
      </Screen>
    );
  }
  const m = money.m;
  const accounts = sortedAccounts(m);
  const cards = money.entries.filter((e) => e.sortOut || kept.has(e.key));

  if (!cards.length) {
    return (
      <Screen>
        <Empty
          title="All sorted"
          body="Nothing waiting. When a friend records paying you back, or an expense you paid shows up from another phone, it comes here so you can say which account it used."
          action={<Button title="Back to Money" variant="secondary" onPress={() => navigation.goBack()} />}
        />
      </Screen>
    );
  }

  const groupName = (id: Id | null) => (id ? state.groups.find((g) => g.id === id)?.name ?? 'A group' : 'Between friends');
  const nameOf = (id: Id) => state.people[id]?.name ?? 'Someone';

  return (
    <Screen>
      <Text style={s.intro}>These came from Split without an account. Say where the money went or came in, and your balances stay right. Only you see your answers.</Text>
      {cards.map((e) => {
        const incoming = (e.moved ?? 0) > 0;
        const link = m.links[e.key];
        const answered = !!link && !open.has(e.key);
        // Who it was with: the friend for a payment or transfer; none for an expense.
        const other = e.payment
          ? incoming
            ? e.payment.from
            : e.payment.to
          : e.transfer
            ? incoming
              ? e.transfer.from
              : e.transfer.to
            : null;
        const moved = Math.abs(e.moved ?? e.amount);
        const title = e.bill ? (incoming ? e.title : `You paid for “${e.title}”`) : e.title;
        const sub = `${groupName(e.groupId)} · ${relativeTime(e.date)}`;
        const choose = (accountId: Id | null) => {
          setKept((k) => new Set(k).add(e.key));
          money.setLink(e.key, { accountId, categoryId: link?.categoryId });
          setOpen((o) => {
            const n = new Set(o);
            n.delete(e.key);
            return n;
          });
        };
        const legend = incoming ? 'Which account did it come into?' : 'Which account did it go from?';
        const noneLabel = incoming ? 'Didn’t get it yet' : 'Don’t track';
        const answer = link
          ? link.accountId
            ? `${incoming ? 'Into' : 'From'} ${m.accounts[link.accountId]?.name ?? 'a deleted account'}`
            : incoming
              ? 'Didn’t get it yet'
              : 'Not tracked'
          : '';
        return (
          <View key={e.key} style={[s.card, !link && s.cardWaiting]} accessibilityLabel={`${title}, ${formatMoney(moved, e.currency)}`}>
            <View style={s.head}>
              {other && meId ? (
                <Avatar id={other} name={nameOf(other)} size={36} />
              ) : (
                <View style={s.icon}>
                  <Icon name={e.bill ? 'split' : 'arrow'} size={18} color={colors.textSoft} />
                </View>
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.title} numberOfLines={2}>
                  {title}
                </Text>
                <Text style={s.sub} numberOfLines={1}>
                  {sub}
                </Text>
              </View>
              <Text style={[s.amount, incoming && { color: colors.owed }]}>{formatMoney(moved, e.currency)}</Text>
            </View>
            {answered ? (
              <View style={s.answered}>
                <Icon name="check" size={16} color={link.accountId ? colors.owed : colors.textSoft} />
                <Text style={[s.answer, { color: link.accountId ? colors.owed : colors.textSoft }]}>{answer}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Change the account for ${title}`}
                  onPress={() => setOpen((o) => new Set(o).add(e.key))}
                  hitSlop={6}
                >
                  <Text style={s.change}>Change</Text>
                </Pressable>
              </View>
            ) : (
              <View accessibilityRole="radiogroup" accessibilityLabel={legend}>
                <Text style={s.legend}>{legend}</Text>
                <View style={s.chips}>
                  {accounts.map((a) => {
                    const on = link?.accountId === a.id;
                    return (
                      <Pressable
                        key={a.id}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: on }}
                        aria-checked={on}
                        accessibilityLabel={`${a.name} for ${title}`}
                        onPress={() => choose(a.id)}
                        style={[s.chip, on && s.chipOn]}
                      >
                        <Text style={[s.chipText, on && s.chipTextOn]}>{a.name}</Text>
                      </Pressable>
                    );
                  })}
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: !!link && link.accountId === null }}
                    aria-checked={!!link && link.accountId === null}
                    accessibilityLabel={`${noneLabel} for ${title}`}
                    onPress={() => choose(null)}
                    style={[s.chip, link && link.accountId === null && s.chipOn]}
                  >
                    <Text style={[s.chipText, { color: colors.textSoft }, link && link.accountId === null && s.chipTextOn]}>{noneLabel}</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        );
      })}
      <Text style={[ui.hint, { marginHorizontal: space.xs }]}>
        Settle-ups aren’t counted as income or spending: they only move money between you and your friends.
      </Text>
    </Screen>
  );
}

const s = StyleSheet.create({
  intro: { fontSize: 13, lineHeight: 19, color: colors.textSoft, marginHorizontal: space.xs, marginBottom: space.md },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 18,
    padding: 14,
    gap: 12,
    marginBottom: space.md,
  },
  cardWaiting: { borderColor: 'rgba(242, 196, 109, 0.45)' },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  icon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 14, fontWeight: '600', color: colors.text },
  sub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  amount: { fontFamily: fonts.medium, fontSize: 15, color: colors.text },
  legend: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { height: 34, paddingHorizontal: 12, borderRadius: 17, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.space, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.star, borderColor: colors.star },
  chipText: { fontSize: 13, color: colors.text },
  chipTextOn: { color: colors.onStar, fontWeight: '700' },
  answered: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  answer: { flex: 1, fontSize: 13 },
  change: { color: colors.star, fontSize: 13, fontWeight: '600' },
});
