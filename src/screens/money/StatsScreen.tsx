// Stats: where your money went this month, by category. Only your share of
// group expenses counts as spending; settle-ups are neither income nor spending.
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { toDay } from '../../dates';
import { formatMoney } from '../../money';
import type { ScreenProps } from '../../navigation';
import { addMonths, byCategory, inRange, monthLabel, monthName, monthOf, monthRange, OUTSIDE, type CategoryTotal, type Ym } from '../../pfm/logic';
import { useMoney } from '../../pfm/store';
import { Icon, MonthSwitcher, OnlyYou, TabBar, TabHeader } from '../../pfm/ui';
import { useStore } from '../../store';
import { colors, fonts, radius, space } from '../../theme';
import { Button, Empty, Segmented } from '../../ui';

type Kind = 'expense' | 'income';

const pad = (n: number) => String(n).padStart(2, '0');

export default function StatsScreen({ navigation }: ScreenProps<'Stats'>) {
  const { m, on, entries } = useMoney();
  const { state } = useStore();
  const st = m.settings;
  const [ym, setYm] = useState<Ym>(() => monthOf(toDay(), st.monthStart));
  const [kind, setKind] = useState<Kind>('expense');
  const [open, setOpen] = useState<string | null>(null);
  const main = st.currency;

  const { list, total, shares, cats } = useMemo(() => {
    const { from, to } = monthRange(ym, st.monthStart);
    const inMonth = inRange(entries, from, to);
    const value = (e: (typeof inMonth)[number]) => (kind === 'expense' ? e.expense : e.income);
    return {
      list: inMonth,
      total: inMonth.reduce((a, e) => a + value(e), 0),
      shares: kind === 'expense' ? inMonth.filter((e) => e.kind === 'share').reduce((a, e) => a + e.expense, 0) : 0,
      cats: byCategory(inMonth, m.categories, kind),
    };
  }, [entries, ym, st.monthStart, kind, m.categories]);

  if (!on) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.space }}>
        <TabHeader>
          <Text style={st_.title}>Stats</Text>
        </TabHeader>
        <View style={{ flex: 1, justifyContent: 'center', padding: space.xl }}>
          <Empty
            title="Money is off"
            body="Turn on Money to see where your money goes each month. Only you see it."
            action={
              <View style={{ gap: space.sm }}>
                <Button title="Turn on Money" onPress={() => navigation.navigate('MoneySetup', { step: 1 })} />
                <Button title="Back to Split" variant="ghost" onPress={() => navigation.popToTop()} />
              </View>
            }
          />
        </View>
      </View>
    );
  }

  const groupName = (key: string) =>
    key === OUTSIDE ? 'with friends' : `in ${state.groups.find((g) => g.id === key)?.name ?? 'a group you left'}`;
  const shareLine = (c: CategoryTotal): string | null => {
    if (!c.shares.length) return null;
    const [key, v] = c.shares[0];
    if (c.shares.length === 1 && v === c.total) return `Your share ${groupName(key)}`;
    if (c.shares.length === 1) return `${formatMoney(v, main)} is your share ${groupName(key)}`;
    const all = c.shares.reduce((a, [, x]) => a + x, 0);
    return `${formatMoney(all, main)} is your share in ${c.shares.length} groups`;
  };
  const biggest = cats[0]?.total ?? 0;
  const budget = kind === 'expense' ? st.budget : null;
  const pct = budget ? Math.round((total / budget) * 100) : 0;
  const over = budget !== null && total > budget;
  const monthParam = `${ym.y}-${pad(ym.m + 1)}`;
  const label = monthLabel(ym, st.monthStart);

  return (
    <View style={{ flex: 1, backgroundColor: colors.space }}>
      <TabHeader right={<View style={{ paddingRight: space.lg }}><OnlyYou /></View>}>
        <MonthSwitcher
          label={label}
          onPrev={() => setYm((x) => addMonths(x, -1))}
          onNext={() => setYm((x) => addMonths(x, 1))}
          prevLabel={monthName(addMonths(ym, -1).m)}
          nextLabel={monthName(addMonths(ym, 1).m)}
        />
      </TabHeader>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: space.xs, paddingBottom: space.xxl }}>
        <Segmented<Kind>
          options={[
            { value: 'expense', label: 'Spending' },
            { value: 'income', label: 'Income' },
          ]}
          value={kind}
          onChange={(k) => {
            setKind(k);
            setOpen(null);
          }}
        />

        <View style={{ marginTop: space.lg, gap: 4 }}>
          <Text style={st_.total} accessibilityRole="header">
            {formatMoney(total, main)} {kind === 'expense' ? 'spent' : 'earned'}
          </Text>
          {shares > 0 ? (
            <View style={st_.shareLine}>
              <Icon name="split" size={14} color={colors.textSoft} />
              <Text style={st_.shareText}>
                {shares === total ? 'All of it is your share in groups' : `${formatMoney(shares, main)} of it is your share in groups`}
              </Text>
            </View>
          ) : null}
        </View>

        {kind === 'expense' ? (
          budget ? (
            <View style={{ marginTop: space.lg, gap: 6 }} accessibilityLabel={`${pct}% of your ${formatMoney(budget, main)} budget used`}>
              <View style={st_.track}>
                <View style={[st_.fill, { width: `${Math.min(100, pct)}%`, backgroundColor: over ? colors.owe : colors.star }]} />
              </View>
              <View style={st_.budgetRow}>
                <Text style={st_.budgetText}>
                  {pct}% of your {formatMoney(budget, main)} budget
                </Text>
                <Text style={[st_.budgetText, over && { color: colors.owe }]}>
                  {over ? `${formatMoney(total - budget, main)} over` : `${formatMoney(budget - total, main)} left`}
                </Text>
              </View>
            </View>
          ) : (
            <Pressable accessibilityRole="link" onPress={() => navigation.replace('More')} hitSlop={6} style={{ marginTop: space.md, alignSelf: 'flex-start' }}>
              <Text style={st_.link}>Set a monthly budget ›</Text>
            </Pressable>
          )
        ) : null}

        {cats.length === 0 ? (
          <View style={{ marginTop: space.xl }}>
            <Empty
              title={`Nothing in ${label}`}
              body={
                kind === 'expense'
                  ? 'Spending you record, and your share of group expenses, shows up here.'
                  : 'Income you record shows up here. Money friends pay you back isn’t counted as income.'
              }
            />
          </View>
        ) : (
          <View style={st_.card}>
            {cats.map((c, i) => {
              const isOpen = open === c.id;
              const sub = shareLine(c);
              const share = total ? Math.round((c.total / total) * 100) : 0;
              const subTotal = c.subs.reduce((a, x) => a + x.total, 0);
              return (
                <View key={c.id} style={[st_.cat, i < cats.length - 1 && st_.divider]}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: isOpen }}
                    aria-expanded={isOpen}
                    accessibilityLabel={`${c.name}, ${formatMoney(c.total, main)}, ${share}%. ${isOpen ? 'Hide details' : 'Show details'}`}
                    onPress={() => setOpen(isOpen ? null : c.id)}
                    style={{ gap: 6 }}
                  >
                    <View style={st_.catTop}>
                      <Text style={st_.catName} numberOfLines={1}>
                        {c.name}
                      </Text>
                      <Text style={st_.catPct}>{share}%</Text>
                      <Text style={st_.catAmount}>{formatMoney(c.total, main)}</Text>
                    </View>
                    <View style={st_.barTrack}>
                      <View
                        style={[
                          st_.bar,
                          { width: `${biggest ? Math.max(2, (c.total / biggest) * 100) : 0}%`, backgroundColor: kind === 'expense' ? colors.star : colors.owed },
                        ]}
                      />
                    </View>
                    {sub ? <Text style={st_.catSub}>{sub}</Text> : null}
                  </Pressable>
                  {isOpen ? (
                    <View style={st_.subs}>
                      {c.subs.map((x) => (
                        <View key={x.id} style={st_.subRow}>
                          <Text style={st_.subName} numberOfLines={1}>
                            {x.name}
                          </Text>
                          <Text style={st_.subAmount}>{formatMoney(x.total, main)}</Text>
                        </View>
                      ))}
                      {c.subs.length > 0 && c.total - subTotal > 0 ? (
                        <View style={st_.subRow}>
                          <Text style={st_.subName} numberOfLines={1}>
                            Just “{c.name}”
                          </Text>
                          <Text style={st_.subAmount}>{formatMoney(c.total - subTotal, main)}</Text>
                        </View>
                      ) : null}
                      <Pressable
                        accessibilityRole="link"
                        onPress={() => navigation.replace('Money', { cat: c.id, month: monthParam })}
                        hitSlop={6}
                        style={{ paddingVertical: 6, alignSelf: 'flex-start' }}
                      >
                        <Text style={st_.link}>See transactions ›</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}

        {list.length > 0 ? (
          <Text style={st_.note}>
            {kind === 'expense'
              ? 'Only your share of a group expense counts as spending. When you pay for everyone, the rest is money lent: it comes back when friends settle up, and isn’t counted as income then either.'
              : 'Money friends pay you back isn’t income, so it’s never counted here. You’ll find it under Accounts, in the account it came into.'}
          </Text>
        ) : null}
      </ScrollView>
      <TabBar current="Stats" />
    </View>
  );
}

const st_ = StyleSheet.create({
  title: { fontFamily: fonts.medium, fontSize: 18, color: colors.text, paddingHorizontal: space.md },
  total: { fontFamily: fonts.light, fontSize: 32, color: colors.text, letterSpacing: -0.8 },
  shareLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shareText: { fontSize: 13, color: colors.textSoft, flexShrink: 1 },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.raised, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  budgetRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  budgetText: { fontSize: 12, color: colors.muted },
  link: { color: colors.star, fontSize: 14, fontWeight: '600' },
  card: {
    marginTop: space.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingVertical: 6,
  },
  cat: { paddingVertical: 10 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.line },
  catTop: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  catName: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },
  catPct: { fontSize: 12, color: colors.muted },
  catAmount: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: colors.raised, overflow: 'hidden' },
  bar: { height: 6, borderRadius: 3 },
  catSub: { fontSize: 12, color: colors.muted },
  subs: { marginTop: space.sm, paddingLeft: space.md, borderLeftWidth: 2, borderLeftColor: colors.line, gap: 2 },
  subRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, gap: space.md },
  subName: { flex: 1, fontSize: 13, color: colors.textSoft },
  subAmount: { fontSize: 13, color: colors.text },
  note: {
    marginTop: space.lg,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSoft,
  },
});
