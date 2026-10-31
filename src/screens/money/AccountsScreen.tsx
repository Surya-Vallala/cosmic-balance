// Accounts: what you have and what you owe, by type, plus what Split says
// friends owe you (and you owe them).
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { currency, formatMoney } from '../../money';
import type { ScreenProps } from '../../navigation';
import { accountTotals, fromSplit, sortedAccounts, toMain } from '../../pfm/logic';
import { useMoney } from '../../pfm/store';
import { ACCOUNT_TYPES, accountType, type Account, type AccountType } from '../../pfm/types';
import { HeaderButton, Icon, OnlyYou, Sum, TabBar, TabHeader } from '../../pfm/ui';
import { useStore } from '../../store';
import { colors, fonts, space } from '../../theme';
import { Button, Empty } from '../../ui';

export default function AccountsScreen({ navigation }: ScreenProps<'Accounts'>) {
  const { m, on, balances, saveAccount, serverMissing } = useMoney();
  const { state } = useStore();
  const [editing, setEditing] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const main = m.settings.currency;

  const visible = useMemo(() => sortedAccounts(m), [m]);
  const deleted = useMemo(() => sortedAccounts(m, true).filter((a) => a.hidden), [m]);
  const split = useMemo(() => fromSplit(m, state), [m, state]);
  const totals = accountTotals(m, balances);
  const assets = totals.assets + split.owedToYou;
  const liabilities = totals.liabilities + split.youOwe;

  if (!on) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.space }}>
        <TabHeader>
          <Text style={st.title}>Accounts</Text>
        </TabHeader>
        <View style={{ flex: 1, justifyContent: 'center', padding: space.xl }}>
          <Empty
            title="Money is off"
            body="Turn on Money to keep track of your bank, cards and cash. Only you see it."
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

  const sections = ACCOUNT_TYPES.map((t) => ({ type: t, list: visible.filter((a) => a.type === t.id) })).filter((x) => x.list.length);

  /** Move an account up or down among those of its type. */
  const move = (type: AccountType, id: string, by: -1 | 1) => {
    const list = visible.filter((a) => a.type === type);
    const i = list.findIndex((a) => a.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    next.forEach((a, idx) => {
      if (a.order !== idx) saveAccount({ ...a, order: idx });
    });
  };

  const subtitle = (a: Account): string | null => {
    const bits: string[] = [];
    if (accountType(a.type).owed) bits.push(accountType(a.type).one);
    if (a.note) bits.push(a.note);
    if (a.currency !== main) {
      bits.push(`In ${currency(a.currency).name} · about ${formatMoney(toMain(m.settings, balances[a.id] ?? 0, a.currency), main, { sign: (balances[a.id] ?? 0) < 0 })}`);
    }
    return bits.length ? bits.join(' · ') : null;
  };

  const money = (v: number, code: string) => formatMoney(v, code, { sign: v < 0 });

  return (
    <View style={{ flex: 1, backgroundColor: colors.space }}>
      <TabHeader
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add an account"
              onPress={() => navigation.navigate('AccountForm', {})}
              hitSlop={4}
              style={st.add}
            >
              <Text style={st.addText}>+ Add</Text>
            </Pressable>
            {visible.length ? (
              <HeaderButton
                icon={editing ? 'check' : 'edit'}
                label={editing ? 'Done arranging' : 'Arrange and edit accounts'}
                active={editing}
                onPress={() => setEditing((v) => !v)}
              />
            ) : null}
          </View>
        }
      >
        <Text style={st.title} accessibilityRole="header">
          Accounts
        </Text>
        <OnlyYou />
      </TabHeader>

      <View style={st.summary}>
        <Sum label="Assets" value={formatMoney(assets, main)} color={colors.owed} />
        <Sum label="Liabilities" value={formatMoney(liabilities, main)} color={colors.owe} />
        <Sum label="Total" value={money(assets - liabilities, main)} color={colors.text} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: space.xxl }}>
        {serverMissing ? <Text style={st.notice}>Saved on this phone only until your Cosmic Balance database is updated.</Text> : null}
        {editing ? <Text style={st.notice}>Use the arrows to change the order. Tap an account to rename it, change its balance or delete it.</Text> : null}

        {visible.length === 0 ? (
          <View style={{ padding: space.lg }}>
            <Empty
              title="Add your accounts"
              body="Your bank accounts, cards, cash and wallets, with what's in them now. Then pick which one paid when you record spending."
              action={<Button title="Add an account" onPress={() => navigation.navigate('AccountForm', {})} />}
            />
          </View>
        ) : (
          sections.map(({ type, list }) => {
            const sub = list.reduce((a, x) => a + toMain(m.settings, balances[x.id] ?? 0, x.currency), 0);
            const oneCurrency = list.every((x) => x.currency === list[0].currency) && list[0].currency !== main;
            const subText = oneCurrency
              ? money(list.reduce((a, x) => a + (balances[x.id] ?? 0), 0), list[0].currency)
              : money(sub, main);
            return (
              <View key={type.id}>
                <View style={st.section} accessibilityRole="header">
                  <Text style={st.sectionText}>{type.many}</Text>
                  <Text style={[st.sectionText, sub < 0 && { color: colors.owe }]}>{subText}</Text>
                </View>
                {list.map((a, i) => {
                  const bal = balances[a.id] ?? 0;
                  const subLine = subtitle(a);
                  return (
                    <View key={a.id} style={[st.rowWrap, st.divider]}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${a.name}, ${money(bal, a.currency)}${editing ? '. Edit' : ''}`}
                        onPress={() => (editing ? navigation.navigate('AccountForm', { accountId: a.id }) : navigation.navigate('Account', { accountId: a.id }))}
                        style={({ pressed }) => [st.row, { flex: 1 }, pressed && { backgroundColor: colors.raised }]}
                      >
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={st.name} numberOfLines={1}>
                            {a.name}
                          </Text>
                          {subLine ? (
                            <Text style={st.sub} numberOfLines={1}>
                              {subLine}
                            </Text>
                          ) : null}
                        </View>
                        <Text style={[st.balance, bal < 0 && { color: colors.owe }]}>{money(bal, a.currency)}</Text>
                      </Pressable>
                      {editing ? (
                        <View style={st.arrows}>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Move ${a.name} up`}
                            disabled={i === 0}
                            onPress={() => move(type.id, a.id, -1)}
                            style={[st.arrow, i === 0 && { opacity: 0.3 }]}
                          >
                            <Text style={st.arrowText}>↑</Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Move ${a.name} down`}
                            disabled={i === list.length - 1}
                            onPress={() => move(type.id, a.id, 1)}
                            style={[st.arrow, i === list.length - 1 && { opacity: 0.3 }]}
                          >
                            <Text style={st.arrowText}>↓</Text>
                          </Pressable>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            );
          })
        )}

        <View style={st.section} accessibilityRole="header">
          <Text style={st.sectionText}>From Split</Text>
          <Text style={[st.sectionText, { color: split.owedToYou - split.youOwe < 0 ? colors.owe : colors.owed }]}>
            {money(split.owedToYou - split.youOwe, main)}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Friends owe you ${formatMoney(split.owedToYou, main)}. Open Split`}
          onPress={() => navigation.popToTop()}
          style={({ pressed }) => [st.row, st.divider, pressed && { backgroundColor: colors.raised }]}
        >
          <Icon name="split" size={18} color={colors.owed} />
          <View style={{ flex: 1, minWidth: 0, marginLeft: space.sm }}>
            <Text style={st.name}>Friends owe you</Text>
            <Text style={st.sub} numberOfLines={1}>
              Kept up to date by your groups and friends
            </Text>
          </View>
          <Text style={[st.balance, { color: colors.owed }]}>{formatMoney(split.owedToYou, main)}</Text>
        </Pressable>
        {split.youOwe > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`You owe friends ${formatMoney(split.youOwe, main)}. Open Split`}
            onPress={() => navigation.popToTop()}
            style={({ pressed }) => [st.row, st.divider, pressed && { backgroundColor: colors.raised }]}
          >
            <Icon name="split" size={18} color={colors.owe} />
            <View style={{ flex: 1, minWidth: 0, marginLeft: space.sm }}>
              <Text style={st.name}>You owe friends</Text>
              <Text style={st.sub} numberOfLines={1}>
                Settle up from Split
              </Text>
            </View>
            <Text style={[st.balance, { color: colors.owe }]}>{formatMoney(split.youOwe, main)}</Text>
          </Pressable>
        ) : null}

        {deleted.length ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showDeleted }}
              aria-expanded={showDeleted}
              onPress={() => setShowDeleted((v) => !v)}
              style={[st.section, { marginTop: space.lg }]}
            >
              <Text style={st.sectionText}>Deleted accounts ({deleted.length})</Text>
              <Text style={st.sectionText}>{showDeleted ? 'Hide' : 'Show'}</Text>
            </Pressable>
            {showDeleted
              ? deleted.map((a) => (
                  <View key={a.id} style={[st.row, st.divider]}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${a.name}, deleted. Open`}
                      onPress={() => navigation.navigate('Account', { accountId: a.id })}
                      style={{ flex: 1, minWidth: 0 }}
                    >
                      <Text style={[st.name, { color: colors.textSoft }]} numberOfLines={1}>
                        {a.name}
                      </Text>
                      <Text style={st.sub} numberOfLines={1}>
                        {accountType(a.type).one} · {money(balances[a.id] ?? 0, a.currency)}
                      </Text>
                    </Pressable>
                    <Button small title="Bring back" variant="secondary" accessibilityLabel={`Bring back ${a.name}`} onPress={() => saveAccount({ ...a, hidden: false })} />
                  </View>
                ))
              : null}
          </>
        ) : null}
      </ScrollView>
      <TabBar current="Accounts" />
    </View>
  );
}

const st = StyleSheet.create({
  title: { fontFamily: fonts.medium, fontSize: 18, color: colors.text, paddingLeft: space.md },
  add: { height: 44, paddingHorizontal: 10, justifyContent: 'center' },
  addText: { color: colors.star, fontSize: 14, fontWeight: '600' },
  summary: {
    flexDirection: 'row',
    height: 58,
    alignItems: 'center',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  notice: { fontSize: 12, color: colors.muted, lineHeight: 17, paddingHorizontal: space.lg, paddingTop: space.md },
  section: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space.md,
    paddingTop: 10,
    paddingBottom: 6,
    paddingHorizontal: space.lg,
    backgroundColor: colors.surface,
  },
  sectionText: { fontSize: 12, fontWeight: '700', color: colors.textSoft },
  rowWrap: { flexDirection: 'row', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: space.lg, paddingVertical: 8, gap: space.md },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.line },
  name: { fontSize: 14, color: colors.text },
  sub: { fontSize: 12, color: colors.muted, marginTop: 1 },
  balance: { fontSize: 14, fontWeight: '600', color: colors.text },
  arrows: { flexDirection: 'row', paddingRight: space.sm },
  arrow: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  arrowText: { fontSize: 18, color: colors.star },
});
