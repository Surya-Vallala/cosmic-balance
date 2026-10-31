// The Money tab: your income and spending, day by day (and your share of
// group expenses), with a calendar, the months of the year, and a summary.

import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { toDay } from '../../dates';
import { formatMoney } from '../../money';
import type { ScreenProps } from '../../navigation';
import {
  accountTotals,
  addMonths,
  byCategory,
  byDay,
  dayOf,
  describeFilter,
  fromSplit,
  inRange,
  isFiltered,
  monthLabel,
  monthOf,
  monthRange,
  NO_FILTER,
  passes,
  shortMonth,
  sums,
  yearRange,
  type Entry,
  type MoneyFilter,
  type Ym,
} from '../../pfm/logic';
import { useMoney } from '../../pfm/store';
import type { MoneyView } from '../../pfm/types';
import { DayHeader, EntryRow, Fab, HeaderButton, MonthSwitcher, OnlyYou, openEntry, SumsRow, TabBar, TabHeader } from '../../pfm/ui';
import { useStore } from '../../store';
import { colors, fonts, space } from '../../theme';
import type { Id } from '../../types';
import { Button, Empty } from '../../ui';
import { FilterPanel } from './FilterPanel';

const VIEWS: { id: MoneyView; label: string }[] = [
  { id: 'daily', label: 'Daily' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'total', label: 'Total' },
];

function monthParam(p?: string): Ym | null {
  const hit = p && /^(\d{4})-(\d{2})$/.exec(p);
  return hit ? { y: Number(hit[1]), m: Number(hit[2]) - 1 } : null;
}

export default function MoneyScreen({ navigation, route }: ScreenProps<'Money'>) {
  const { state } = useStore();
  const insets = useSafeAreaInsets();
  const { m, entries, sortOut, on, balances } = useMoney();
  const st = m.settings;
  const start = st.monthStart;
  const cur = st.currency;
  const today = toDay();
  const [view, setView] = useState<MoneyView>(st.opensOn);
  const [ym, setYm] = useState<Ym>(() => monthParam(route.params?.month) ?? monthOf(today, start));
  const [year, setYear] = useState(() => ym.y);
  const [filter, setFilter] = useState<MoneyFilter>(() => {
    const cat = route.params?.cat;
    if (!cat) return NO_FILTER;
    const kind = m.categories[cat]?.kind ?? 'expense';
    return { ...NO_FILTER, [kind]: [cat] };
  });
  const [filterOpen, setFilterOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  const groupName = (id: Id | null) => (id ? state.groups.find((g) => g.id === id)?.name ?? 'A group you left' : 'No group');
  const range = view === 'monthly' ? yearRange(year, start) : monthRange(ym, start);
  const period = useMemo(() => inRange(entries, range.from, range.to), [entries, range.from, range.to]);
  const shown = useMemo(() => period.filter((e) => passes(e, filter, m.categories)), [period, filter, m.categories]);
  const totals = sums(shown);
  const filtered = isFiltered(filter);

  if (!on) {
    return (
      <View style={st2.wrap}>
        <TabHeader>
          <Text style={st2.title}>Money</Text>
        </TabHeader>
        <View style={{ flex: 1, justifyContent: 'center', padding: space.xl }}>
          <Empty
            title="Money is off"
            body="Keep track of your own accounts, income and spending, right next to Split. Only you see it."
            action={<Button title="Turn on Money" onPress={() => navigation.navigate('MoneySetup', { step: 1 })} />}
          />
        </View>
      </View>
    );
  }

  const label = view === 'monthly' ? String(year) : monthLabel(ym, start);
  const step = (n: number) => {
    setPicked(null);
    if (view === 'monthly') setYear((y) => y + n);
    else setYm((x) => addMonths(x, n));
  };
  const settleCount = sortOut.filter((e) => e.kind === 'settle').length;
  const banner =
    sortOut.length === 0
      ? null
      : settleCount === sortOut.length
        ? `${settleCount} settle-up${settleCount === 1 ? '' : 's'}: which account?`
        : `${sortOut.length} from Split: which account?`;
  // The + sits above the bottom bar (and the filter bar, when there is one).
  const fabBottom = 60 + insets.bottom + (filtered ? 52 : 0) + 16;

  return (
    <View style={st2.wrap}>
      <TabHeader
        right={
          <>
            <HeaderButton icon="search" label="Search" onPress={() => navigation.navigate('MoneySearch')} />
            <HeaderButton icon="filter" label={filtered ? 'Filter (on)' : 'Filter'} active={filtered} onPress={() => setFilterOpen(true)} />
          </>
        }
      >
        <MonthSwitcher
          label={label}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          prevLabel={view === 'monthly' ? 'Previous year' : 'Previous month'}
          nextLabel={view === 'monthly' ? 'Next year' : 'Next month'}
        />
        <OnlyYou />
      </TabHeader>

      <View style={st2.views} accessibilityRole="tablist" accessibilityLabel="View">
        {VIEWS.map((v) => (
          <Pressable
            key={v.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: view === v.id }}
            aria-selected={view === v.id}
            onPress={() => {
              setPicked(null);
              if (v.id === 'monthly') setYear(ym.y);
              setView(v.id);
            }}
            style={[st2.viewTab, view === v.id && st2.viewTabOn]}
          >
            <Text style={[st2.viewText, view === v.id && st2.viewTextOn]}>{v.label}</Text>
          </Pressable>
        ))}
      </View>

      <SumsRow income={totals.income} expense={totals.expense} currency={cur} />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 96 }}>
        {banner ? (
          <Pressable accessibilityRole="button" onPress={() => navigation.navigate('SortOut')} style={st2.banner}>
            <View style={st2.bannerDot} />
            <Text style={st2.bannerText}>{banner}</Text>
            <Text style={{ color: colors.muted, fontSize: 16 }}>›</Text>
          </Pressable>
        ) : null}

        {view === 'daily' ? (
          <Daily list={shown} m={m} groupName={groupName} cur={cur} onOpen={(e) => openEntry(navigation, e)} empty={emptyText(label, filtered)} />
        ) : view === 'calendar' ? (
          <Calendar
            list={shown}
            ym={ym}
            from={range.from}
            to={range.to}
            weekStart={st.weekStart}
            cur={cur}
            today={today}
            picked={picked}
            onPick={(d) => setPicked(d === picked ? null : d)}
          >
            {picked ? (
              <Daily
                list={shown.filter((e) => e.day === picked)}
                m={m}
                groupName={groupName}
                cur={cur}
                onOpen={(e) => openEntry(navigation, e)}
                empty="Nothing on this day."
              />
            ) : null}
          </Calendar>
        ) : view === 'monthly' ? (
          <Monthly
            list={shown}
            year={year}
            start={start}
            cur={cur}
            today={today}
            onPick={(x) => {
              setYm(x);
              setView('daily');
            }}
          />
        ) : (
          <Total
            list={shown}
            prev={inRange(entries, monthRange(addMonths(ym, -1), start).from, monthRange(addMonths(ym, -1), start).to).filter((e) =>
              passes(e, filter, m.categories),
            )}
            prevLabel={shortMonth(addMonths(ym, -1).m)}
            budget={st.budget}
            cur={cur}
            m={m}
            netWorth={(() => {
              const t = accountTotals(m, balances);
              const split = fromSplit(m, state);
              return t.assets + split.owedToYou - t.liabilities - split.youOwe;
            })()}
            hasAccounts={Object.values(m.accounts).some((a) => !a.hidden)}
            onStats={() => navigation.replace('Stats')}
            onAccounts={() => navigation.replace('Accounts')}
          />
        )}
      </ScrollView>

      <Fab onPress={() => navigation.navigate('Record', {})} bottom={fabBottom} />

      {filtered ? (
        <View style={st2.filterBar}>
          <Text style={st2.filterText} numberOfLines={1}>
            {describeFilter(filter, m, (id) => groupName(id))}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Change the filter" onPress={() => setFilterOpen(true)} style={st2.filterAction}>
            <Text style={{ color: colors.star, fontWeight: '600' }}>Edit</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Clear the filter" onPress={() => setFilter(NO_FILTER)} style={st2.filterAction}>
            <Text style={{ color: colors.text, fontSize: 18 }}>×</Text>
          </Pressable>
        </View>
      ) : null}
      <TabBar current="Money" />

      <FilterPanel
        visible={filterOpen}
        value={filter}
        onApply={setFilter}
        onClose={() => setFilterOpen(false)}
        m={m}
        entries={period}
        groupName={groupName}
        groupIds={state.groups.map((g) => g.id)}
        period={label}
      />
    </View>
  );
}

const emptyText = (label: string, filtered: boolean) =>
  filtered ? `Nothing in ${label} matches the filter.` : `Nothing in ${label} yet. Tap + to record what you spend or earn; your share of group expenses shows up here by itself.`;

function Daily({
  list,
  m,
  groupName,
  cur,
  onOpen,
  empty,
}: {
  list: Entry[];
  m: ReturnType<typeof useMoney>['m'];
  groupName: (id: Id | null) => string;
  cur: string;
  onOpen: (e: Entry) => void;
  empty: string;
}) {
  if (!list.length) return <Text style={st2.empty}>{empty}</Text>;
  return (
    <>
      {byDay(list).map((d, i) => (
        <View key={d.day}>
          <DayHeader day={d.day} income={d.income} expense={d.expense} currency={cur} first={i === 0} />
          {d.entries.map((e) => (
            <EntryRow key={e.key} e={e} m={m} groupName={groupName} onPress={() => onOpen(e)} showTime={m.settings.showTime} showDetails={m.settings.showDetails} />
          ))}
        </View>
      ))}
    </>
  );
}

/** The weeks of a period, Monday (or Sunday) first. */
function weeksOf(from: string, to: string, weekStart: 0 | 1): (string | null)[][] {
  const [y, mo, d] = from.split('-').map(Number);
  const first = new Date(y, mo - 1, d);
  const lead = (first.getDay() - weekStart + 7) % 7;
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let i = 0; ; i++) {
    const day = dayOf(y, mo - 1, d + i);
    if (day >= to) break;
    cells.push(day);
  }
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

const short = (minor: number) => {
  const v = Math.round(minor / 100);
  if (v >= 100000) return `${(v / 100000).toFixed(v >= 1000000 ? 0 : 1)}L`;
  if (v >= 10000) return `${Math.round(v / 1000)}k`;
  return String(v);
};

function Calendar({
  list,
  from,
  to,
  weekStart,
  cur,
  today,
  picked,
  onPick,
  children,
}: {
  list: Entry[];
  ym: Ym;
  from: string;
  to: string;
  weekStart: 0 | 1;
  cur: string;
  today: string;
  picked: string | null;
  onPick: (day: string) => void;
  children?: React.ReactNode;
}) {
  const perDay = useMemo(() => {
    const t: Record<string, { income: number; expense: number }> = {};
    for (const e of list) {
      const x = (t[e.day] = t[e.day] ?? { income: 0, expense: 0 });
      x.income += e.income;
      x.expense += e.expense;
    }
    return t;
  }, [list]);
  const names = weekStart === 1 ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return (
    <View>
      <View style={st2.calHead}>
        {names.map((n, i) => (
          <Text key={n} style={[st2.calHeadText, (weekStart === 1 ? i >= 5 : i === 0 || i === 6) && { color: colors.muted }]}>
            {n}
          </Text>
        ))}
      </View>
      {weeksOf(from, to, weekStart).map((w, i) => (
        <View key={i} style={st2.calWeek}>
          {w.map((day, j) => {
            if (!day) return <View key={j} style={st2.calCell} />;
            const t = perDay[day];
            const sel = picked === day;
            const dd = Number(day.slice(8));
            return (
              <Pressable
                key={day}
                accessibilityRole="button"
                accessibilityState={{ selected: sel }}
                aria-selected={sel}
                accessibilityLabel={`${dd} ${shortMonth(Number(day.slice(5, 7)) - 1)}${t ? `, income ${formatMoney(t.income, cur)}, spent ${formatMoney(t.expense, cur)}` : ''}`}
                onPress={() => onPick(day)}
                style={[st2.calCell, sel && st2.calCellOn]}
              >
                <Text style={[st2.calDay, day === today && st2.calToday]}>{dd}</Text>
                {t?.income ? <Text style={[st2.calAmt, { color: colors.owed }]}>{short(t.income)}</Text> : null}
                {t?.expense ? <Text style={[st2.calAmt, { color: colors.owe }]}>{short(t.expense)}</Text> : null}
              </Pressable>
            );
          })}
        </View>
      ))}
      {children ?? <Text style={st2.empty}>Tap a day to see what happened.</Text>}
    </View>
  );
}

function Monthly({ list, year, start, cur, today, onPick }: { list: Entry[]; year: number; start: number; cur: string; today: string; onPick: (ym: Ym) => void }) {
  const now = monthOf(today, start);
  const months: Ym[] = [];
  for (let mo = 11; mo >= 0; mo--) {
    const x = { y: year, m: mo };
    if (x.y > now.y || (x.y === now.y && x.m > now.m)) continue;
    months.push(x);
  }
  if (!months.length) return <Text style={st2.empty}>Nothing in {year} yet.</Text>;
  return (
    <View>
      {months.map((x) => {
        const r = monthRange(x, start);
        const t = sums(inRange(list, r.from, r.to));
        return (
          <Pressable
            key={x.m}
            accessibilityRole="button"
            accessibilityLabel={`${monthLabel(x, start)}: income ${formatMoney(t.income, cur)}, spent ${formatMoney(t.expense, cur)}`}
            onPress={() => onPick(x)}
            style={({ pressed }) => [st2.monthRow, pressed && { backgroundColor: colors.raised }]}
          >
            <View style={{ width: 64 }}>
              <Text style={st2.monthName}>{shortMonth(x.m)}</Text>
              {start > 1 ? <Text style={st2.monthSub}>from {start}</Text> : null}
            </View>
            <Text style={[st2.monthAmt, { color: colors.owed }]}>{formatMoney(t.income, cur)}</Text>
            <Text style={[st2.monthAmt, { color: colors.owe }]}>{formatMoney(t.expense, cur)}</Text>
            <Text style={[st2.monthAmt, { color: colors.text }]}>{formatMoney(t.net, cur, { sign: t.net < 0 })}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Total({
  list,
  prev,
  prevLabel,
  budget,
  cur,
  m,
  netWorth,
  hasAccounts,
  onStats,
  onAccounts,
}: {
  list: Entry[];
  prev: Entry[];
  prevLabel: string;
  budget: number | null;
  cur: string;
  m: ReturnType<typeof useMoney>['m'];
  netWorth: number;
  hasAccounts: boolean;
  onStats: () => void;
  onAccounts: () => void;
}) {
  const t = sums(list);
  const p = sums(prev);
  const shares = list.filter((e) => e.kind === 'share').reduce((a, e) => a + e.expense, 0);
  const top = byCategory(list, m.categories).slice(0, 5);
  const diff = t.expense - p.expense;
  return (
    <View style={{ padding: space.lg, gap: space.md }}>
      <View style={st2.card}>
        <Text style={st2.cardLabel}>Spent</Text>
        <Text style={st2.big}>{formatMoney(t.expense, cur)}</Text>
        {shares ? (
          <Text style={st2.cardSub}>
            {formatMoney(t.expense - shares, cur)} on your own · {formatMoney(shares, cur)} your share in groups
          </Text>
        ) : null}
        {p.expense || t.expense ? (
          <Text style={st2.cardSub}>
            {diff === 0 ? `The same as ${prevLabel}` : `${formatMoney(Math.abs(diff), cur)} ${diff > 0 ? 'more' : 'less'} than ${prevLabel}`}
          </Text>
        ) : null}
        {budget ? (
          <View style={{ marginTop: space.sm, gap: 6 }}>
            <View style={st2.track}>
              <View style={[st2.fill, { width: `${Math.min(100, Math.round((t.expense / budget) * 100))}%`, backgroundColor: t.expense > budget ? colors.owe : colors.star }]} />
            </View>
            <Text style={st2.cardSub}>
              {Math.round((t.expense / budget) * 100)}% of your {formatMoney(budget, cur)} budget ·{' '}
              {t.expense > budget ? `${formatMoney(t.expense - budget, cur)} over` : `${formatMoney(budget - t.expense, cur)} left`}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={[st2.card, { flexDirection: 'row' }]}>
        <View style={{ flex: 1 }}>
          <Text style={st2.cardLabel}>Earned</Text>
          <Text style={[st2.mid, { color: colors.owed }]}>{formatMoney(t.income, cur)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={st2.cardLabel}>Left over</Text>
          <Text style={st2.mid}>{formatMoney(t.net, cur, { sign: t.net < 0 })}</Text>
        </View>
      </View>
      {top.length ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Where it went, in Stats" onPress={onStats} style={st2.card}>
          <Text style={st2.cardLabel}>Where it went</Text>
          {top.map((c) => (
            <View key={c.id} style={st2.topRow}>
              <Text style={st2.topName} numberOfLines={1}>
                {c.name}
              </Text>
              <Text style={st2.topAmt}>{formatMoney(c.total, cur)}</Text>
            </View>
          ))}
          <Text style={st2.link}>See everything in Stats ›</Text>
        </Pressable>
      ) : null}
      {hasAccounts ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Your accounts" onPress={onAccounts} style={st2.card}>
          <Text style={st2.cardLabel}>All your accounts, with what friends owe you</Text>
          <Text style={st2.mid}>{formatMoney(netWorth, cur, { sign: netWorth < 0 })}</Text>
          <Text style={st2.link}>See accounts ›</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const st2 = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.space },
  title: { fontFamily: fonts.medium, fontSize: 18, color: colors.text, paddingHorizontal: space.md },
  views: { flexDirection: 'row', height: 42, borderBottomWidth: 1, borderBottomColor: colors.line },
  viewTab: { flex: 1, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  viewTabOn: { borderBottomColor: colors.star },
  viewText: { fontSize: 14, fontWeight: '500', color: colors.muted },
  viewTextOn: { color: colors.text, fontWeight: '600' },
  banner: {
    marginHorizontal: space.lg,
    marginTop: 10,
    marginBottom: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 42,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(242, 196, 109, 0.45)',
    backgroundColor: 'rgba(242, 196, 109, 0.06)',
  },
  bannerDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.star },
  bannerText: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.text },
  empty: { fontSize: 14, lineHeight: 20, color: colors.muted, textAlign: 'center', paddingHorizontal: space.xl, paddingTop: space.xl },
  calHead: { flexDirection: 'row', paddingHorizontal: space.sm, paddingTop: space.sm },
  calHeadText: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600', color: colors.textSoft },
  calWeek: { flexDirection: 'row', paddingHorizontal: space.sm },
  calCell: { flex: 1, minHeight: 58, margin: 1, borderRadius: 8, paddingTop: 4, alignItems: 'center', gap: 1 },
  calCellOn: { backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.star },
  calDay: { fontSize: 13, color: colors.text },
  calToday: { color: colors.star, fontWeight: '700' },
  calAmt: { fontSize: 10 },
  monthRow: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: space.lg, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 6 },
  monthName: { fontFamily: fonts.medium, fontSize: 15, color: colors.text },
  monthSub: { fontSize: 11, color: colors.muted },
  monthAmt: { flex: 1, textAlign: 'right', fontSize: 13, fontWeight: '600' },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 18, padding: space.lg, gap: 4 },
  cardLabel: { fontSize: 12, color: colors.textSoft },
  cardSub: { fontSize: 12, color: colors.muted, lineHeight: 17 },
  big: { fontFamily: fonts.light, fontSize: 30, letterSpacing: -0.6, color: colors.text },
  mid: { fontFamily: fonts.medium, fontSize: 18, color: colors.text },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.raised, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  topRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  topName: { flex: 1, fontSize: 14, color: colors.text },
  topAmt: { fontSize: 14, fontWeight: '600', color: colors.text },
  link: { marginTop: 6, color: colors.star, fontWeight: '600', fontSize: 13 },
  filterBar: { flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingLeft: space.lg, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.surface },
  filterText: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.text },
  filterAction: { minWidth: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
});
