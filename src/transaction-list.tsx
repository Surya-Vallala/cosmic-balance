// A list of expenses (and payments or transfers) in sections by day (by month
// for a group that spans months), with a search box and "Only ones I'm in"
// once it gets long. Tap a day to fold it away; Collapse all leaves just the
// days, to find one quickly.
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { matchesSearch, sections, sectionsBy, sectionSummary, type ItemKind } from './list-view';
import { colors, space } from './theme';
import type { CurrencyCode } from './types';
import { List, SearchBox, Sparkle } from './ui';

export interface TxItem {
  key: string;
  date: string;
  kind: ItemKind;
  /** What was spent, for the section's total (expenses only). */
  spent?: { amount: number; currency: CurrencyCode };
  /** You paid or have a share (expenses), or gave or received it (payments). */
  involvesMe: boolean;
  /** Added or changed by a friend since your last visit. */
  isNew?: boolean;
  /** Words and amounts it can be found by. */
  search: { texts: (string | null | undefined)[]; amounts: number[]; dates: string[] };
  render: (o: { last: boolean; showDate: boolean }) => React.ReactNode;
}

/** From this many, the list gets a search box, a filter and Collapse all. */
export const LONG_LIST = 6;

export function TransactionList({
  items,
  noun = 'expenses',
  filterable = true,
}: {
  /** Newest first. */
  items: TxItem[];
  /** For the search box and messages: "expenses". */
  noun?: string;
  /** Offer "Only ones I'm in" (when some aren't). */
  filterable?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [onlyMine, setOnlyMine] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  // By day for a trip, by month for a group that spans months.
  const by = useMemo(() => sectionsBy(items), [items]);
  const long = items.length >= LONG_LIST;
  const canFilter = filterable && long && items.some((i) => !i.involvesMe) && items.some((i) => i.involvesMe);
  const searching = query.trim().length > 0;

  const shown = useMemo(
    () =>
      items.filter(
        (i) => (!onlyMine || !canFilter || i.involvesMe) && (!searching || matchesSearch(query, i.search.texts, i.search.amounts, i.search.dates)),
      ),
    [items, onlyMine, canFilter, searching, query],
  );
  const groups = useMemo(() => sections(shown, by), [shown, by]);
  const allFolded = groups.length > 0 && groups.every((g) => collapsed.has(g.key));

  const toggle = (key: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const filtered = searching || (onlyMine && canFilter);

  return (
    <View>
      {long ? (
        <>
          <SearchBox
            value={query}
            onChangeText={setQuery}
            placeholder={`Search ${noun}`}
            accessibilityLabel={`Search ${noun}`}
            style={{ marginBottom: space.sm }}
          />
          <View style={s.tools}>
            {canFilter ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: onlyMine }}
                aria-pressed={onlyMine}
                accessibilityLabel="Only ones I’m in"
                onPress={() => setOnlyMine((v) => !v)}
                hitSlop={4}
                style={[s.toggle, onlyMine && s.toggleOn]}
              >
                <View style={[s.box, onlyMine && s.boxOn]}>{onlyMine ? <Text style={s.tick}>✓</Text> : null}</View>
                <Text style={[s.toggleText, onlyMine && { color: colors.text }]}>Only ones I’m in</Text>
              </Pressable>
            ) : (
              <View />
            )}
            {!searching && groups.length > 1 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setCollapsed(allFolded ? new Set() : new Set(groups.map((g) => g.key)))}
                hitSlop={8}
              >
                <Text style={s.link}>{allFolded ? 'Expand all' : 'Collapse all'}</Text>
              </Pressable>
            ) : null}
          </View>
          {filtered ? (
            <Text style={s.count}>
              {shown.length === 0
                ? searching
                  ? `No ${noun} match “${query.trim()}”${onlyMine && canFilter ? ' among the ones you’re in' : ''}.`
                  : `You’re not in any of these ${noun}.`
                : `${shown.length} of ${items.length}`}
              {'  '}
              <Text
                style={s.link}
                accessibilityRole="button"
                onPress={() => {
                  setQuery('');
                  setOnlyMine(false);
                }}
              >
                Show all
              </Text>
            </Text>
          ) : null}
        </>
      ) : null}

      {groups.map((g) => {
        const folded = !searching && collapsed.has(g.key);
        const summary = sectionSummary(g.items);
        const hasNew = g.items.some((i) => i.isNew);
        return (
          <View key={g.key} style={{ marginTop: space.sm }}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: !folded }}
              aria-expanded={!folded}
              accessibilityLabel={`${g.label}, ${summary}${hasNew ? ', something new' : ''}`}
              disabled={searching}
              onPress={() => toggle(g.key)}
              style={({ pressed }) => [s.head, pressed && { opacity: 0.6 }]}
            >
              <Text style={[s.chevron, folded && s.chevronFolded]}>›</Text>
              <Text style={s.headLabel} numberOfLines={1}>
                {g.label}
              </Text>
              {hasNew && folded ? (
                <View style={{ marginLeft: 6 }}>
                  <Sparkle size={10} />
                </View>
              ) : null}
              <Text style={s.headSummary} numberOfLines={1}>
                {summary}
              </Text>
            </Pressable>
            {folded ? null : (
              <List>
                {g.items.map((it, i) => (
                  <React.Fragment key={it.key}>{it.render({ last: i === g.items.length - 1, showDate: by === 'month' })}</React.Fragment>
                ))}
              </List>
            )}
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  tools: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: space.xs },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },
  toggleOn: { borderColor: colors.star, backgroundColor: colors.starSoft },
  box: { width: 14, height: 14, borderRadius: 4, borderWidth: 1.5, borderColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
  boxOn: { borderColor: colors.star, backgroundColor: colors.star },
  tick: { fontSize: 10, lineHeight: 12, fontWeight: '800', color: colors.space },
  toggleText: { fontSize: 13, color: colors.textSoft, fontWeight: '500' },
  link: { fontSize: 13, color: colors.star, fontWeight: '600' },
  count: { fontSize: 12, color: colors.muted, marginTop: space.sm, marginHorizontal: space.xs },
  head: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: space.xs },
  chevron: { width: 14, fontSize: 16, lineHeight: 18, color: colors.muted, transform: [{ rotate: '90deg' }], textAlign: 'center' },
  chevronFolded: { transform: [{ rotate: '0deg' }] },
  headLabel: { fontSize: 13, fontWeight: '700', color: colors.textSoft, marginLeft: 6, flexShrink: 0 },
  headSummary: { flex: 1, fontSize: 12, color: colors.muted, textAlign: 'right', marginLeft: space.md },
});
