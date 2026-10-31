// Money's filter: tick the income and spending categories, accounts and
// groups to see; the list and its totals follow.

import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatMoney } from '../../money';
import {
  NO_FILTER,
  OUTSIDE,
  OWN,
  passes,
  sortedAccounts,
  subCategories,
  sums,
  topCategories,
  topOf,
  type Entry,
  type MoneyFilter,
} from '../../pfm/logic';
import { ACCOUNT_TYPES, type MoneyData } from '../../pfm/types';
import { colors, fonts, space } from '../../theme';
import type { Id } from '../../types';
import { Button } from '../../ui';

type Tab = 'income' | 'expense' | 'accounts' | 'groups';
const TABS: { id: Tab; label: string }[] = [
  { id: 'income', label: 'Income' },
  { id: 'expense', label: 'Expenses' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'groups', label: 'Groups' },
];

export function FilterPanel({
  visible,
  value,
  onApply,
  onClose,
  m,
  entries,
  groupName,
  groupIds,
  period,
}: {
  visible: boolean;
  value: MoneyFilter;
  onApply: (f: MoneyFilter) => void;
  onClose: () => void;
  m: MoneyData;
  /** This period's entries (unfiltered). */
  entries: Entry[];
  groupName: (id: Id | null) => string;
  groupIds: Id[];
  period: string;
}) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<MoneyFilter>(value);
  const [tab, setTab] = useState<Tab>('expense');
  const [open, setOpen] = useState<Id | null>(null);
  // Each time it opens: start from the filter in use.
  const [wasVisible, setWasVisible] = useState(false);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setDraft(value);
      setOpen(null);
    }
  }

  const cats = m.categories;
  const shown = useMemo(() => entries.filter((e) => passes(e, draft, cats)), [entries, draft, cats]);
  const totals = sums(shown);
  const all = sums(entries);
  const cur = m.settings.currency;

  // Amounts beside each choice, for this period.
  const catTotals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const e of entries) {
      const v = e.kind === 'income' ? e.income : e.expense;
      if (!v || !e.categoryId) continue;
      t[e.categoryId] = (t[e.categoryId] ?? 0) + v;
      const top = topOf(cats, e.categoryId);
      if (top !== e.categoryId) t[top] = (t[top] ?? 0) + v;
    }
    return t;
  }, [entries, cats]);
  const accTotals = useMemo(() => {
    const t: Record<string, { inn: number; out: number }> = {};
    const add = (id: Id | null, inn: number, out: number) => {
      if (!id) return;
      const x = (t[id] = t[id] ?? { inn: 0, out: 0 });
      x.inn += inn;
      x.out += out;
    };
    for (const e of entries) {
      if (e.kind === 'income') add(e.accountId, e.amount, 0);
      else if (e.kind === 'expense') add(e.accountId, 0, e.amount);
      else if (e.kind === 'transfer') {
        add(e.accountId, 0, e.amount);
        add(e.toAccountId, e.toAmount ?? e.amount, 0);
      } else if (e.moved !== undefined && e.accountId) {
        if (e.moved > 0) add(e.accountId, e.moved, 0);
        else add(e.accountId, 0, -e.moved);
      }
    }
    return t;
  }, [entries]);
  const groupTotals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const e of entries) {
      if (e.kind === 'share') {
        const k = e.groupId ?? OUTSIDE;
        t[k] = (t[k] ?? 0) + e.expense;
      } else if (e.kind === 'expense') t[OWN] = (t[OWN] ?? 0) + e.expense;
    }
    return t;
  }, [entries]);

  // ---- Ticking ------------------------------------------------------------------
  const kind = tab === 'income' || tab === 'expense' ? tab : null;
  const tops = kind ? topCategories(cats, kind) : [];
  const catList = kind ? draft[kind] : null;
  const isOn = (id: Id) => catList === null || catList.includes(id) || (catList.includes(topOf(cats, id)) && topOf(cats, id) !== id);
  // Everything this tab can tick (spending also has shares with no category).
  const everything = kind === 'expense' ? [...tops.map((c) => c.id), 'split'] : tops.map((c) => c.id);
  const setCats = (list: Id[]) => kind && setDraft((d) => ({ ...d, [kind]: everything.every((x) => list.includes(x)) ? null : list }));
  const toggleTop = (id: Id) => {
    const list = catList === null ? everything : catList;
    const subs = subCategories(cats, id).map((c) => c.id);
    const on = list.includes(id) || (subs.length > 0 && subs.every((x) => list.includes(x)));
    const without = list.filter((x) => x !== id && !subs.includes(x));
    setCats(on ? without : [...without, id]);
  };
  const toggleSub = (parent: Id, id: Id) => {
    const list = catList === null ? everything : catList;
    const subs = subCategories(cats, parent).map((c) => c.id);
    let next = list.includes(parent) ? [...list.filter((x) => x !== parent), ...subs] : [...list];
    next = next.includes(id) ? next.filter((x) => x !== id) : [...next, id];
    if (subs.length && subs.every((x) => next.includes(x))) next = [...next.filter((x) => !subs.includes(x)), parent];
    setCats(next);
  };
  const toggleIn = (key: 'accounts' | 'groups', id: Id, everything: Id[]) =>
    setDraft((d) => {
      const list = d[key] === null ? everything : (d[key] as Id[]);
      const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
      return { ...d, [key]: everything.every((x) => next.includes(x)) ? null : next };
    });

  const accounts = sortedAccounts(m, true).filter((a) => !a.hidden || accTotals[a.id]);
  const groupKeys = [...groupIds, OUTSIDE, OWN];
  const groupLabel = (k: string) => (k === OWN ? 'Only my own' : k === OUTSIDE ? 'With friends, no group' : groupName(k));

  const allRow = (checked: boolean, onPress: () => void, label: string, right?: React.ReactNode) => (
    <Check checked={checked} onPress={onPress} label="All" a11y={label} muted right={right} divider />
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[f.wrap, { paddingTop: insets.top }]}>
        <View style={f.top}>
          <Text style={f.title} accessibilityRole="header">
            Filter · {period}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close filter" onPress={onClose} style={f.close}>
            <Text style={{ color: colors.text, fontSize: 22 }}>×</Text>
          </Pressable>
        </View>
        <Text style={f.lead}>Tick what you want to see. The list and its totals follow.</Text>
        <View style={f.summary}>
          <Summary label="Income" value={formatMoney(totals.income, cur)} sub={`of ${formatMoney(all.income, cur)}`} color={colors.owed} />
          <Summary label="Expenses" value={formatMoney(totals.expense, cur)} sub={`of ${formatMoney(all.expense, cur)}`} color={colors.owe} />
          <Summary label="Selected" value={formatMoney(totals.net, cur, { sign: true })} sub={`${shown.length} transaction${shown.length === 1 ? '' : 's'}`} color={colors.text} />
        </View>
        <View style={f.tabs} accessibilityRole="tablist">
          {TABS.map((t) => {
            const filtered = t.id === 'income' || t.id === 'expense' ? draft[t.id] !== null : draft[t.id] !== null;
            return (
              <Pressable
                key={t.id}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === t.id }}
                aria-selected={tab === t.id}
                onPress={() => {
                  setTab(t.id);
                  setOpen(null);
                }}
                style={[f.tab, tab === t.id && f.tabOn]}
              >
                <Text style={[f.tabText, tab === t.id && f.tabTextOn]}>
                  {t.label}
                  {filtered ? ' •' : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: space.xl }}>
          {kind ? (
            <>
              {allRow(
                catList === null,
                () => kind && setDraft((d) => ({ ...d, [kind]: catList === null ? [] : null })),
                kind === 'income' ? 'All income categories' : 'All expense categories',
              )}
              {tops.map((c) => {
                const subs = m.settings.subcategories ? subCategories(cats, c.id) : [];
                const expanded = open === c.id;
                const someSubs = catList !== null && subs.some((x) => catList.includes(x.id)) && !catList.includes(c.id);
                return (
                  <View key={c.id} style={expanded && { backgroundColor: colors.surface }}>
                    <Check
                      checked={isOn(c.id) || (subs.length > 0 && subs.every((x) => isOn(x.id)))}
                      partial={someSubs}
                      onPress={() => toggleTop(c.id)}
                      label={c.name}
                      amount={catTotals[c.id] ? formatMoney(catTotals[c.id], cur) : undefined}
                      right={
                        subs.length ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`${expanded ? 'Hide' : 'Show'} ${c.name}'s sub-categories`}
                            onPress={() => setOpen(expanded ? null : c.id)}
                            hitSlop={8}
                            style={f.expand}
                          >
                            <Text style={{ color: colors.textSoft, fontSize: 16 }}>{expanded ? '⌃' : '⌄'}</Text>
                          </Pressable>
                        ) : undefined
                      }
                    />
                    {expanded
                      ? subs.map((x) => (
                          <Check
                            key={x.id}
                            indent
                            checked={isOn(x.id)}
                            onPress={() => toggleSub(c.id, x.id)}
                            label={x.name}
                            amount={catTotals[x.id] ? formatMoney(catTotals[x.id], cur) : undefined}
                          />
                        ))
                      : null}
                  </View>
                );
              })}
              {kind === 'expense' ? (
                <Check
                  checked={catList === null || catList.includes('split')}
                  onPress={() => {
                    const list = catList === null ? everything : catList;
                    setCats(list.includes('split') ? list.filter((x) => x !== 'split') : [...list, 'split']);
                  }}
                  label="Split with friends"
                  amount={catTotals.split ? formatMoney(catTotals.split, cur) : undefined}
                />
              ) : null}
              <Text style={f.note}>
                {kind === 'income'
                  ? 'Money friends pay you back isn’t income, so it’s never in this list. Find it under Accounts or Groups.'
                  : 'Your share of group expenses counts here too, in the category you gave it (or “Split with friends”).'}
              </Text>
            </>
          ) : tab === 'accounts' ? (
            <>
              {allRow(
                draft.accounts === null,
                () => setDraft((d) => ({ ...d, accounts: d.accounts === null ? [] : null })),
                'All accounts',
                <View style={{ flexDirection: 'row' }}>
                  <Text style={[f.col, { color: colors.owed }]}>In</Text>
                  <Text style={[f.col, { color: colors.owe }]}>Out</Text>
                </View>,
              )}
              {ACCOUNT_TYPES.map((t) => {
                const list = accounts.filter((a) => a.type === t.id);
                if (!list.length) return null;
                return (
                  <View key={t.id}>
                    <Text style={f.group}>{t.many}</Text>
                    {list.map((a) => (
                      <Check
                        key={a.id}
                        checked={draft.accounts === null || draft.accounts.includes(a.id)}
                        onPress={() => toggleIn('accounts', a.id, accounts.map((x) => x.id))}
                        label={a.name}
                        right={
                          <View style={{ flexDirection: 'row' }}>
                            <Text style={f.col}>{accTotals[a.id]?.inn ? formatMoney(accTotals[a.id].inn, a.currency) : '—'}</Text>
                            <Text style={f.col}>{accTotals[a.id]?.out ? formatMoney(accTotals[a.id].out, a.currency) : '—'}</Text>
                          </View>
                        }
                      />
                    ))}
                  </View>
                );
              })}
              {!accounts.length ? <Text style={f.note}>No accounts yet. Add them in the Accounts tab.</Text> : null}
            </>
          ) : (
            <>
              {allRow(
                draft.groups === null,
                () => setDraft((d) => ({ ...d, groups: d.groups === null ? [] : null })),
                'All groups',
                <Text style={{ fontSize: 12, color: colors.muted }}>your share</Text>,
              )}
              {groupKeys.map((k) => (
                <Check
                  key={k}
                  checked={draft.groups === null || draft.groups.includes(k)}
                  onPress={() => toggleIn('groups', k, groupKeys)}
                  label={groupLabel(k)}
                  amount={groupTotals[k] ? formatMoney(groupTotals[k], cur) : undefined}
                />
              ))}
              <Text style={f.note}>See just one trip’s spending, or only what you spent on your own.</Text>
            </>
          )}
        </ScrollView>
        <View style={[f.footer, { paddingBottom: space.md + insets.bottom }]}>
          <View style={{ flex: 1 }}>
            <Button title="Clear" variant="secondary" onPress={() => setDraft(NO_FILTER)} />
          </View>
          <View style={{ flex: 2 }}>
            <Button
              title={`Show ${shown.length} transaction${shown.length === 1 ? '' : 's'}`}
              onPress={() => {
                onApply(draft);
                onClose();
              }}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Summary({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
      <Text style={{ fontSize: 12, color: colors.textSoft }}>{label}</Text>
      <Text style={{ fontSize: 15, fontWeight: '600', color }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={{ fontSize: 11, color: colors.muted }} numberOfLines={1}>
        {sub}
      </Text>
    </View>
  );
}

function Check({
  checked,
  partial,
  onPress,
  label,
  a11y,
  amount,
  right,
  indent,
  muted,
  divider,
}: {
  checked: boolean;
  partial?: boolean;
  onPress: () => void;
  label: string;
  a11y?: string;
  amount?: string;
  right?: React.ReactNode;
  indent?: boolean;
  muted?: boolean;
  divider?: boolean;
}) {
  return (
    <View style={[f.check, indent && { paddingLeft: 50, minHeight: 42 }, divider && f.divider]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: partial ? 'mixed' : checked }}
        aria-checked={partial ? 'mixed' : checked}
        accessibilityLabel={a11y ?? label}
        onPress={onPress}
        style={f.checkHit}
      >
        <View style={[f.box, indent && { width: 18, height: 18 }, (checked || partial) && f.boxOn]}>
          {checked ? <Text style={f.tick}>✓</Text> : partial ? <Text style={f.tick}>–</Text> : null}
        </View>
        <Text style={[f.checkLabel, muted && { color: colors.textSoft }, indent && { fontSize: 14 }]} numberOfLines={1}>
          {label}
        </Text>
        {amount ? <Text style={f.amount}>{amount}</Text> : null}
      </Pressable>
      {right}
    </View>
  );
}

const f = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.space },
  top: { flexDirection: 'row', alignItems: 'center', paddingLeft: space.lg, minHeight: 52 },
  title: { flex: 1, fontFamily: fonts.medium, fontSize: 17, color: colors.text },
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  lead: { fontSize: 13, color: colors.textSoft, paddingHorizontal: space.lg, marginBottom: space.sm },
  summary: { flexDirection: 'row', paddingVertical: space.md, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.line },
  tab: { flex: 1, height: 44, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: colors.star },
  tabText: { fontSize: 13, fontWeight: '500', color: colors.muted },
  tabTextOn: { color: colors.text, fontWeight: '700' },
  check: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, minHeight: 46 },
  checkHit: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 44 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.line, minHeight: 48 },
  box: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.star, borderColor: colors.star },
  tick: { color: colors.onStar, fontSize: 13, fontWeight: '800', lineHeight: 15 },
  checkLabel: { flex: 1, fontSize: 15, color: colors.text },
  amount: { fontSize: 14, color: colors.textSoft },
  expand: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  group: { paddingTop: 10, paddingBottom: 4, paddingHorizontal: space.lg, backgroundColor: colors.surface, fontSize: 12, fontWeight: '700', color: colors.textSoft },
  col: { width: 88, textAlign: 'right', fontSize: 12, color: colors.textSoft },
  note: { marginHorizontal: space.lg, marginTop: space.md, fontSize: 12, lineHeight: 17, color: colors.muted },
  footer: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.line },
});
