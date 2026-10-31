// For each group: the account you usually pay from, and what your share
// counts as. Private: friends never see any of it.
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ScreenProps } from '../../navigation';
import { categoryPath, OUTSIDE, SPLIT_CATEGORY } from '../../pfm/logic';
import { useMoney } from '../../pfm/store';
import { AccountSheet, CategorySheet, OnlyYou } from '../../pfm/ui';
import { useStore } from '../../store';
import { colors, fonts, space } from '../../theme';
import { GroupBadge, List, Screen, styles as ui } from '../../ui';

export default function GroupMoneyScreen(_props: ScreenProps<'GroupMoney'>) {
  const { state } = useStore();
  const { m, setSettings } = useMoney();
  const st = m.settings;
  const [picking, setPicking] = useState<null | { key: string; what: 'account' | 'category' }>(null);

  const groups = [...state.groups.map((g) => ({ key: g.id, name: g.name })), { key: OUTSIDE, name: 'No group (with friends)' }];

  const accountValue = (key: string) => {
    const v = st.usual[key];
    if (v === null) return 'Don’t track';
    if (v && m.accounts[v] && !m.accounts[v].hidden) return m.accounts[v].name;
    return 'Not set';
  };
  const categoryValue = (key: string) => {
    const c = st.groupCategory[key];
    return categoryPath(m.categories, c && m.categories[c] ? c : SPLIT_CATEGORY).join(' › ');
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: space.xs }}>
        <OnlyYou label="only you see this" />
      </View>
      <Text style={[ui.hint, { marginTop: 0, marginBottom: space.md }]}>
        For each group: the account you usually pay from, and what your share counts as. Only you see this.
      </Text>
      {groups.map((g) => (
        <View key={g.key} style={{ marginBottom: space.md }}>
          <List>
            <View style={[st2.head, ui.rowDivider]}>
              {g.key === OUTSIDE ? null : <GroupBadge name={g.name} size={28} />}
              <Text style={st2.groupName} numberOfLines={1}>
                {g.name}
              </Text>
            </View>
            <Line label="Usual account" value={accountValue(g.key)} onPress={() => setPicking({ key: g.key, what: 'account' })} />
            <Line label="Shares count as" value={categoryValue(g.key)} onPress={() => setPicking({ key: g.key, what: 'category' })} last />
          </List>
        </View>
      ))}
      <Text style={ui.hint}>
        “Shares count as” is the category your part of each expense goes under in Stats. You can still change it for a single expense.
      </Text>

      <AccountSheet
        visible={picking?.what === 'account'}
        onClose={() => setPicking(null)}
        title="Usual account"
        selected={picking ? st.usual[picking.key] : undefined}
        none={{ label: 'Don’t track', hint: 'Don’t ask which account for this group' }}
        onPick={(id) => {
          if (!picking) return;
          setSettings({ usual: { ...st.usual, [picking.key]: id } });
        }}
      />
      <CategorySheet
        visible={picking?.what === 'category'}
        kind="expense"
        title="Shares count as"
        selected={picking ? st.groupCategory[picking.key] : undefined}
        onClose={() => setPicking(null)}
        onPick={(id) => {
          if (!picking) return;
          setSettings({ groupCategory: { ...st.groupCategory, [picking.key]: id } });
        }}
      />
    </Screen>
  );
}

function Line({ label, value, onPress, last }: { label: string; value: string; onPress: () => void; last?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}. Change`}
      onPress={onPress}
      style={({ pressed }) => [st2.line, !last && ui.rowDivider, pressed && { backgroundColor: colors.raised }]}
    >
      <Text style={st2.label}>{label}</Text>
      <Text style={st2.value} numberOfLines={1}>
        {value}
      </Text>
      <Text style={st2.chevron}>›</Text>
    </Pressable>
  );
}

const st2 = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg },
  groupName: { flex: 1, fontFamily: fonts.medium, fontSize: 15, color: colors.text },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48, paddingHorizontal: space.lg },
  label: { fontSize: 14, color: colors.textSoft },
  value: { flex: 1, fontSize: 14, color: colors.text, textAlign: 'right' },
  chevron: { fontSize: 20, color: colors.muted, lineHeight: 22 },
});
