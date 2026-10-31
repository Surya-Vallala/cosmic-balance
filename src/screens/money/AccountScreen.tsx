// One account: its balance, this month's money in and out, and everything
// that moved it, newest first.
import React, { useLayoutEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { dayLabel, toDay } from '../../dates';
import { formatMoney } from '../../money';
import type { ScreenProps } from '../../navigation';
import { categoryPath, changeIn, monthName, monthOf, monthRange, toMain, type Entry } from '../../pfm/logic';
import { useMoney } from '../../pfm/store';
import { accountType } from '../../pfm/types';
import { Fab, Icon, openEntry } from '../../pfm/ui';
import { useStore } from '../../store';
import { colors, fonts, space } from '../../theme';
import type { Id } from '../../types';
import { Button, Chip, Empty } from '../../ui';

type Show = 'all' | 'spending' | 'income' | 'friends';
const SHOW: { value: Show; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'spending', label: 'Spending' },
  { value: 'income', label: 'Income' },
  { value: 'friends', label: 'From friends' },
];

interface Line {
  e: Entry;
  change: number;
}

/** "Ravi", "Ravi and Kiran", "3 friends". */
function names(list: string[]): string {
  if (list.length <= 2) return list.join(' and ');
  return `${list.length} friends`;
}

export default function AccountScreen({ navigation, route }: ScreenProps<'Account'>) {
  const { m, entries, balances, saveAccount } = useMoney();
  const { state } = useStore();
  const insets = useSafeAreaInsets();
  const [show, setShow] = useState<Show>('all');
  const id = route.params.accountId;
  const a = m.accounts[id];
  const main = m.settings.currency;

  useLayoutEffect(() => {
    navigation.setOptions({
      title: a?.name ?? 'Account',
      headerRight: () =>
        a ? (
          <Pressable
            onPress={() => navigation.navigate('AccountForm', { accountId: id })}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${a.name}`}
          >
            <Text style={st.headerLink}>Edit</Text>
          </Pressable>
        ) : null,
    });
  }, [navigation, a, id]);

  const lines: Line[] = useMemo(() => {
    const out: Line[] = [];
    for (const e of entries) {
      const touches = e.record ? e.accountId === id || e.toAccountId === id : e.split && e.accountId === id;
      if (!touches) continue;
      out.push({ e, change: changeIn(m, state, e, id) });
    }
    return out;
  }, [entries, m, state, id]);

  if (!a) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.space, justifyContent: 'center', padding: space.xl }}>
        <Empty title="This account was deleted" body="Go back to see your other accounts." />
      </View>
    );
  }

  const bal = balances[id] ?? a.opening;
  const ym = monthOf(toDay(), m.settings.monthStart);
  const { from, to } = monthRange(ym, m.settings.monthStart);
  let monthIn = 0;
  let monthOut = 0;
  for (const l of lines) {
    if (l.e.day < from || l.e.day >= to) continue;
    if (l.change > 0) monthIn += l.change;
    else monthOut -= l.change;
  }

  const shown = lines.filter(({ e }) => {
    if (show === 'spending') return e.kind === 'expense';
    if (show === 'income') return e.kind === 'income';
    if (show === 'friends') return e.split;
    return true;
  });
  const days: { day: string; inn: number; out: number; lines: Line[] }[] = [];
  for (const l of shown) {
    let d = days[days.length - 1];
    if (!d || d.day !== l.e.day) {
      d = { day: l.e.day, inn: 0, out: 0, lines: [] };
      days.push(d);
    }
    if (l.change > 0) d.inn += l.change;
    else d.out -= l.change;
    d.lines.push(l);
  }

  const money = (v: number) => formatMoney(v, a.currency, { sign: true });
  const groupName = (gid: Id | null) => (gid ? state.groups.find((g) => g.id === gid)?.name ?? 'A group you left' : 'Between friends');
  const nameOf = (pid: Id) => (pid === state.meId ? 'you' : state.people[pid]?.name ?? 'someone');

  /** What a line says: title and up to two lines under it. */
  const describe = ({ e, change }: Line): { title: string; lines: string[] } => {
    if (e.record) {
      const r = e.record;
      if (r.kind === 'transfer') {
        const out = r.accountId === id && change <= 0;
        const other = m.accounts[out ? r.toAccountId ?? '' : r.accountId]?.name ?? 'a deleted account';
        const to = r.toAccountId ? m.accounts[r.toAccountId] : undefined;
        const loaded = out && to && to.currency !== a.currency && r.toAmount !== undefined ? `Loaded ${formatMoney(r.toAmount, to.currency)} · ` : '';
        return { title: out ? `Moved to ${other}` : `Moved from ${other}`, lines: [`${loaded}between your accounts${r.note ? ` · ${r.note}` : ''}`] };
      }
      const path = categoryPath(m.categories, e.categoryId).join(' › ');
      return { title: r.note || path, lines: [r.kind === 'income' ? `Income · ${path}` : path] };
    }
    if (e.bill) {
      const x = e.bill;
      const me = state.meId ?? '';
      const share = x.shares[me] ?? 0;
      const paid = x.payers[me] ?? 0;
      const lent = paid - share;
      const owers = Object.keys(x.shares).filter((p) => p !== me && (x.shares[p] ?? 0) > 0).map(nameOf);
      const out = [share > 0 ? `${groupName(x.groupId)} · your share ${formatMoney(share, x.currency)}` : `${groupName(x.groupId)} · you paid for friends`];
      if (lent > 0) out.push(`${formatMoney(lent, x.currency)} lent to ${names(owers)}`);
      return { title: x.description, lines: out };
    }
    const what = e.transfer?.kind === 'transfer' ? 'money between friends' : 'settle-up';
    return { title: e.title ?? '', lines: [`${groupName(e.groupId)} · ${what}, ${change > 0 ? 'not income' : 'not spending'}`] };
  };

  const type = accountType(a.type);
  const added = new Date(a.createdAt);

  return (
    <View style={{ flex: 1, backgroundColor: colors.space }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 96 + insets.bottom }}>
        <View style={st.top}>
          <Text style={[st.balance, bal < 0 && { color: colors.owe }]} accessibilityRole="header">
            {formatMoney(bal, a.currency, { sign: bal < 0 })}
          </Text>
          {a.currency !== main ? (
            <Text style={st.meta}>About {formatMoney(toMain(m.settings, bal, a.currency), main, { sign: bal < 0 })}</Text>
          ) : null}
          <Text style={st.meta}>
            {type.one}
            {a.note ? ` · ${a.note}` : ''}
          </Text>
          <Text style={st.month}>
            {monthName(ym.m)}: <Text style={{ color: colors.owed }}>{formatMoney(monthIn, a.currency)} in</Text>
            {' · '}
            <Text style={{ color: colors.owe }}>{formatMoney(monthOut, a.currency)} out</Text>
          </Text>
          {a.hidden ? (
            <View style={st.deleted}>
              <Text style={st.deletedText}>You deleted this account. Its past transactions keep its name.</Text>
              <Button small title="Bring back" variant="secondary" onPress={() => saveAccount({ ...a, hidden: false })} />
            </View>
          ) : null}
        </View>

        <View style={st.chips}>
          {SHOW.map((o) => (
            <Chip key={o.value} label={o.label} selected={show === o.value} onPress={() => setShow(o.value)} />
          ))}
        </View>

        {days.length === 0 ? (
          <Text style={st.empty}>
            {show === 'all'
              ? 'Nothing recorded in this account yet. Tap + to add income or spending.'
              : 'Nothing like that in this account yet.'}
          </Text>
        ) : (
          days.map((d, i) => (
            <View key={d.day}>
              <View style={[st.day, i > 0 && st.dayGap]} accessibilityRole="header">
                <Text style={st.dayLabel}>{dayLabel(d.day)}</Text>
                <Text style={st.dayTotals}>
                  {[d.inn ? `+${formatMoney(d.inn, a.currency)}` : null, d.out ? `−${formatMoney(d.out, a.currency)}` : null].filter(Boolean).join(' · ')}
                </Text>
              </View>
              {d.lines.map((l) => {
                const what = describe(l);
                return (
                  <Pressable
                    key={l.e.key}
                    accessibilityRole="button"
                    accessibilityLabel={`${what.title}. ${what.lines.join('. ')}. ${money(l.change)}`}
                    onPress={() => openEntry(navigation, l.e)}
                    style={({ pressed }) => [st.line, pressed && { backgroundColor: colors.raised }]}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                        {l.e.split ? <Icon name="split" size={12} color={colors.muted} /> : null}
                        <Text style={st.lineTitle} numberOfLines={1}>
                          {what.title}
                        </Text>
                      </View>
                      {what.lines.map((x, k) => (
                        <Text key={k} style={st.lineSub} numberOfLines={1}>
                          {x}
                        </Text>
                      ))}
                    </View>
                    <Text style={[st.lineAmount, { color: l.change > 0 ? colors.owed : l.change < 0 ? colors.text : colors.muted }]}>
                      {l.change === 0 ? formatMoney(0, a.currency) : money(l.change)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ))
        )}

        <View style={[st.day, st.dayGap]}>
          <Text style={st.dayLabel}>Opening balance</Text>
          <Text style={st.dayTotals}>{formatMoney(a.opening, a.currency, { sign: a.opening < 0 })}</Text>
        </View>
        <Text style={st.openNote}>
          {type.owed ? 'What you owed' : 'What was in it'} when you added it
          {Number.isNaN(added.getTime()) ? '' : `, ${dayLabel(toDay(added))}`}. Edit the account to change it.
        </Text>
      </ScrollView>
      {a.hidden ? null : (
        <Fab bottom={insets.bottom + space.lg} label={`Record a transaction in ${a.name}`} onPress={() => navigation.navigate('Record', { accountId: id })} />
      )}
    </View>
  );
}

const st = StyleSheet.create({
  headerLink: { color: colors.star, fontSize: 16, fontWeight: '600', paddingHorizontal: 8 },
  top: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.md, gap: 4 },
  balance: { fontFamily: fonts.light, fontSize: 34, color: colors.text, letterSpacing: -0.8 },
  meta: { fontSize: 13, color: colors.textSoft },
  month: { fontSize: 13, color: colors.textSoft, marginTop: space.xs },
  deleted: { marginTop: space.md, padding: space.md, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, gap: space.sm },
  deletedText: { fontSize: 13, color: colors.textSoft, lineHeight: 19 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.md },
  empty: { fontSize: 13, color: colors.muted, paddingHorizontal: space.lg, paddingVertical: space.lg, lineHeight: 19 },
  day: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  dayGap: { borderTopWidth: 6, borderTopColor: colors.surface },
  dayLabel: { fontSize: 13, fontWeight: '600', color: colors.text },
  dayTotals: { fontSize: 12, color: colors.muted },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 10, minHeight: 52 },
  lineTitle: { fontSize: 14, color: colors.text, flexShrink: 1 },
  lineSub: { fontSize: 12, color: colors.muted, marginTop: 1 },
  lineAmount: { fontSize: 14, fontWeight: '600' },
  openNote: { fontSize: 12, color: colors.muted, paddingHorizontal: space.lg, paddingTop: space.sm, lineHeight: 17 },
});
