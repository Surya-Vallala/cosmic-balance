// Search Money: every word in the note, more details, category, account,
// group or people. The totals of what's found are shown on top.

import React, { useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { toDay } from '../../dates';
import type { ScreenProps } from '../../navigation';
import { byDay, inRange, matches, monthOf, monthRange, sums, yearRange, type Entry } from '../../pfm/logic';
import { useMoney } from '../../pfm/store';
import { DayHeader, EntryRow, openEntry, Sheet, SheetRow, SumsRow } from '../../pfm/ui';
import { useStore } from '../../store';
import { colors, space } from '../../theme';
import type { Id } from '../../types';
import { Chip } from '../../ui';

type Period = 'all' | 'month' | 'year';
const PERIODS: { id: Period; label: string }[] = [
  { id: 'all', label: 'All time' },
  { id: 'month', label: 'This month' },
  { id: 'year', label: 'This year' },
];
type Kind = 'all' | 'expense' | 'income' | 'transfer';
const KINDS: { id: Kind; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'expense', label: 'Expense' },
  { id: 'income', label: 'Income' },
  { id: 'transfer', label: 'Transfer' },
];

const kindOf = (e: Entry): Kind => (e.kind === 'income' ? 'income' : e.kind === 'expense' || e.kind === 'share' ? 'expense' : 'transfer');

export default function MoneySearchScreen({ navigation }: ScreenProps<'MoneySearch'>) {
  const insets = useSafeAreaInsets();
  const { state } = useStore();
  const { m, entries } = useMoney();
  const [q, setQ] = useState('');
  const [period, setPeriod] = useState<Period>('all');
  const [kind, setKind] = useState<Kind>('all');
  const [pickPeriod, setPickPeriod] = useState(false);
  const groupName = (id: Id | null) => (id ? state.groups.find((g) => g.id === id)?.name ?? 'A group you left' : 'No group');

  const found = useMemo(() => {
    if (!q.trim()) return [];
    const today = toDay();
    const now = monthOf(today, m.settings.monthStart);
    let list = entries;
    if (period === 'month') {
      const r = monthRange(now, m.settings.monthStart);
      list = inRange(list, r.from, r.to);
    } else if (period === 'year') {
      const r = yearRange(now.y, m.settings.monthStart);
      list = inRange(list, r.from, r.to);
    }
    return list.filter((e) => (kind === 'all' || kindOf(e) === kind) && matches(e, q));
  }, [entries, q, period, kind, m.settings.monthStart]);
  const t = sums(found);

  return (
    <View style={{ flex: 1, backgroundColor: colors.space }}>
      <View style={[x.top, { paddingTop: insets.top + 6 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => navigation.goBack()} style={x.back}>
          <Text style={{ color: colors.text, fontSize: 22 }}>←</Text>
        </Pressable>
        <View style={x.box}>
          <TextInput
            value={q}
            onChangeText={setQ}
            autoFocus
            placeholder="Search transactions"
            placeholderTextColor={colors.placeholder}
            accessibilityLabel="Search transactions"
            style={x.input}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
          />
          {q ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQ('')} hitSlop={8} style={x.clear}>
              <Text style={{ color: colors.textSoft, fontSize: 18 }}>×</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <View style={x.filters}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Period: ${PERIODS.find((p) => p.id === period)!.label}. Change`} onPress={() => setPickPeriod(true)} style={x.period}>
          <Text style={x.periodText}>{PERIODS.find((p) => p.id === period)!.label} ▾</Text>
        </Pressable>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingRight: space.lg }}>
          {KINDS.map((k) => (
            <Chip key={k.id} label={k.label} selected={kind === k.id} onPress={() => setKind(k.id)} />
          ))}
        </ScrollView>
      </View>
      {q.trim() ? <SumsRow income={t.income} expense={t.expense} currency={m.settings.currency} /> : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: space.xxl + insets.bottom }} keyboardShouldPersistTaps="handled">
        {!q.trim() ? (
          <Text style={x.hint}>Find anything by a word in its note or details, its category or account, the group or the people in it.</Text>
        ) : (
          <>
            <Text style={x.count} accessibilityLiveRegion="polite">
              {found.length === 0
                ? `Nothing with “${q.trim()}”.`
                : `${found.length} transaction${found.length === 1 ? '' : 's'} with “${q.trim()}” in the note, details, category, account or group`}
            </Text>
            {byDay(found).map((d, i) => (
              <View key={d.day}>
                <DayHeader day={d.day} income={d.income} expense={d.expense} currency={m.settings.currency} first={i === 0} />
                {d.entries.map((e) => (
                  <EntryRow key={e.key} e={e} m={m} groupName={groupName} highlight={q} showDetails onPress={() => openEntry(navigation, e)} />
                ))}
              </View>
            ))}
          </>
        )}
      </ScrollView>
      <Sheet visible={pickPeriod} onClose={() => setPickPeriod(false)} title="When">
        {PERIODS.map((p) => (
          <SheetRow
            key={p.id}
            title={p.label}
            selected={period === p.id}
            onPress={() => {
              setPeriod(p.id);
              setPickPeriod(false);
            }}
          />
        ))}
      </Sheet>
    </View>
  );
}

const x = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xs, paddingBottom: 6, gap: 4 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  box: { flex: 1, flexDirection: 'row', alignItems: 'center', height: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.raised, marginRight: space.md },
  input: { flex: 1, height: 44, paddingHorizontal: space.md, color: colors.text, fontSize: 15, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : {}) },
  clear: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  filters: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.lg, paddingBottom: space.sm },
  period: { height: 34, paddingHorizontal: 12, borderRadius: 17, borderWidth: 1, borderColor: colors.line, justifyContent: 'center' },
  periodText: { color: colors.text, fontSize: 13 },
  hint: { fontSize: 14, lineHeight: 20, color: colors.muted, padding: space.xl, textAlign: 'center' },
  count: { fontSize: 12, color: colors.muted, paddingHorizontal: space.lg, paddingVertical: space.sm },
});
