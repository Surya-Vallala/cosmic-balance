import React, { useLayoutEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { groupNet } from '../logic';
import { approxRate, currency, CURRENCY_CODES, parseNumber } from '../money';
import type { ScreenProps } from '../navigation';
import { uid, useStore } from '../store';
import { colors, fonts, space } from '../theme';
import type { CurrencyCode } from '../types';
import {
  Avatar,
  Button,
  Chip,
  ConfirmButton,
  CurrencyPicker,
  Field,
  List,
  Screen,
  SectionTitle,
  SmallInput,
  styles as ui,
  symbolPrefix,
} from '../ui';

export default function GroupFormScreen({ navigation, route }: ScreenProps<'GroupForm'>) {
  const { state, dispatch } = useStore();
  const meId = state.meId!;
  const existing = state.groups.find((g) => g.id === route.params.groupId);

  const [name, setName] = useState(existing?.name ?? '');
  const [members, setMembers] = useState<string[]>(existing?.memberIds ?? [meId]);
  const [simplify, setSimplify] = useState(existing?.simplifyDebts ?? true);
  const [newFriend, setNewFriend] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const [base, setBase] = useState<CurrencyCode>(existing?.baseCurrency ?? 'INR');
  const [rateInputs, setRateInputs] = useState<Record<CurrencyCode, string>>(
    Object.fromEntries(Object.entries(existing?.rates ?? {}).map(([c, r]) => [c, String(r)])),
  );
  const [picker, setPicker] = useState<null | 'base' | 'add'>(null);
  const [currencyError, setCurrencyError] = useState<string | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({ title: existing ? 'Edit group' : 'New group' });
  }, [navigation, existing]);

  const friends = Object.values(state.people)
    .filter((p) => p.id !== meId)
    .sort((a, b) => a.name.localeCompare(b.name));

  const groupExpenses = existing ? state.expenses.filter((x) => x.groupId === existing.id) : [];
  const groupPayments = existing ? state.payments.filter((x) => x.groupId === existing.id) : [];

  // People who appear in this group's expenses or payments can't be removed.
  const locked = new Set<string>([meId]);
  for (const e of groupExpenses) {
    Object.keys(e.payers).forEach((id) => locked.add(id));
    Object.keys(e.shares).forEach((id) => locked.add(id));
  }
  for (const p of groupPayments) {
    locked.add(p.from);
    locked.add(p.to);
  }

  // Currencies already used can't be removed, and the main currency is fixed
  // once anything has been added.
  const usedCurrencies = new Set([...groupExpenses.map((e) => e.currency), ...groupPayments.map((p) => p.currency)]);
  const baseLocked = groupExpenses.length + groupPayments.length > 0;
  const extras = Object.keys(rateInputs);

  const toggle = (id: string) => {
    setError(null);
    if (members.includes(id)) {
      if (locked.has(id)) {
        setError(
          id === meId
            ? "You're always part of your own groups."
            : `${state.people[id]?.name} is in this group's expenses, so they can't be removed. Delete or edit those expenses first.`,
        );
        return;
      }
      setMembers(members.filter((m) => m !== id));
    } else {
      setMembers([...members, id]);
    }
  };

  const addFriend = () => {
    const n = newFriend.trim();
    if (!n) return;
    const match = friends.find((f) => f.name.toLowerCase() === n.toLowerCase());
    if (match) {
      if (!members.includes(match.id)) setMembers([...members, match.id]);
    } else {
      const id = uid();
      dispatch({ type: 'savePerson', person: { id, name: n } });
      setMembers([...members, id]);
    }
    setNewFriend('');
  };

  const changeBase = (code: CurrencyCode) => {
    setCurrencyError(null);
    setBase(code);
    // Re-express the other currencies against the new main currency.
    const next: Record<CurrencyCode, string> = {};
    for (const c of extras) if (c !== code) next[c] = String(approxRate(c, code));
    setRateInputs(next);
  };

  const addCurrency = (code: CurrencyCode) => {
    setCurrencyError(null);
    setRateInputs({ ...rateInputs, [code]: String(approxRate(code, base)) });
  };

  const removeCurrency = (code: CurrencyCode) => {
    if (usedCurrencies.has(code)) {
      setCurrencyError(`Some expenses or payments in this group are in ${currency(code).name}, so it can't be removed.`);
      return;
    }
    const next = { ...rateInputs };
    delete next[code];
    setRateInputs(next);
  };

  const save = () => {
    setTouched(true);
    if (!name.trim()) return;
    if (members.length < 2) {
      setError('Add at least one friend to the group.');
      return;
    }
    const rates: Record<CurrencyCode, number> = {};
    for (const c of extras) {
      const r = parseNumber(rateInputs[c] ?? '');
      if (!r || r <= 0) {
        setCurrencyError(`Enter a rate for ${currency(c).name}, for example ${approxRate(c, base)}.`);
        return;
      }
      rates[c] = r;
    }
    const id = existing?.id ?? uid();
    dispatch({
      type: 'saveGroup',
      group: {
        id,
        name: name.trim(),
        memberIds: members,
        simplifyDebts: simplify,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        baseCurrency: base,
        rates,
      },
    });
    if (existing) navigation.goBack();
    else navigation.replace('Group', { groupId: id });
  };

  const hasBalance = existing && Object.values(groupNet(existing, state.expenses, state.payments)).some((v) => v !== 0);
  const baseC = currency(base);

  return (
    <Screen footer={<Button title={existing ? 'Save changes' : 'Create group'} onPress={save} />}>
      <Field
        label="Group name"
        value={name}
        onChangeText={setName}
        placeholder="Thailand trip, Flat 302, Office lunch…"
        autoCapitalize="sentences"
        error={touched && !name.trim() ? 'Give the group a name.' : null}
      />

      <Text style={ui.label}>Who's in it</Text>
      <View style={s.chips}>
        <Chip
          label="You"
          selected
          onPress={() => toggle(meId)}
          leading={<Avatar name={state.people[meId]?.name ?? 'You'} size={20} />}
        />
        {friends.map((f) => (
          <Chip
            key={f.id}
            label={f.name}
            selected={members.includes(f.id)}
            onPress={() => toggle(f.id)}
            leading={<Avatar name={f.name} size={20} />}
          />
        ))}
      </View>
      {error ? <Text style={ui.error}>{error}</Text> : null}

      <View style={s.addRow}>
        <TextInput
          value={newFriend}
          onChangeText={setNewFriend}
          placeholder="Add someone new by name"
          placeholderTextColor={colors.placeholder}
          keyboardAppearance="dark"
          selectionColor={colors.star}
          style={[ui.input, { flex: 1 }]}
          onSubmitEditing={addFriend}
          returnKeyType="done"
          autoCapitalize="words"
        />
        <Button title="Add" small variant="secondary" onPress={addFriend} disabled={!newFriend.trim()} style={{ minHeight: 48 }} />
      </View>

      <SectionTitle>Currencies</SectionTitle>
      <List>
        <Pressable
          disabled={baseLocked}
          onPress={() => setPicker('base')}
          accessibilityRole="button"
          accessibilityLabel={`Main currency: ${baseC.name}. Change`}
          style={({ pressed }) => [s.curRow, extras.length > 0 && s.divider, pressed && { backgroundColor: colors.raised }]}
        >
          <View style={ui.sheetSymbol}>
            <Text style={ui.sheetSymbolText} numberOfLines={1} adjustsFontSizeToFit>
              {baseC.symbol}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={ui.rowTitle}>{baseC.name}</Text>
            <Text style={ui.rowSubtitle}>Main currency. Balances are worked out in this.</Text>
          </View>
          {baseLocked ? null : <Text style={s.link}>Change</Text>}
        </Pressable>

        {extras.map((c, i) => {
          const cur = currency(c);
          return (
            <View key={c} style={[s.curRow, i < extras.length - 1 && s.divider]}>
              <View style={ui.sheetSymbol}>
                <Text style={ui.sheetSymbolText} numberOfLines={1} adjustsFontSizeToFit>
                  {cur.symbol}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={ui.rowTitle}>{cur.name}</Text>
                <View style={s.rateLine}>
                  <Text style={s.rateText}>{symbolPrefix(c)}1 =</Text>
                  <Text style={s.rateText}>{symbolPrefix(base)}</Text>
                  <SmallInput
                    value={rateInputs[c]}
                    onChangeText={(v) => setRateInputs({ ...rateInputs, [c]: v })}
                    style={{ width: 84, textAlign: 'left' }}
                    accessibilityLabel={`${cur.name} rate in ${baseC.name}`}
                  />
                </View>
              </View>
              <Pressable onPress={() => removeCurrency(c)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${cur.name}`}>
                <Text style={s.remove}>Remove</Text>
              </Pressable>
            </View>
          );
        })}
      </List>
      {currencyError ? <Text style={ui.error}>{currencyError}</Text> : null}
      <Button
        title={extras.length ? 'Add another currency' : 'Add a currency for this group'}
        variant="secondary"
        small
        onPress={() => setPicker('add')}
        style={{ marginTop: space.md, alignSelf: 'flex-start' }}
      />
      <Text style={ui.hint}>
        {extras.length
          ? 'Rates start at an approximate value. Set them to whatever your group agrees on. Changing a rate updates every balance in the group.'
          : 'Travelling? Add the local currency so you can enter expenses in it.'}
        {baseLocked ? ' The main currency is fixed once expenses are added.' : ''}
      </Text>

      <View style={s.switchRow}>
        <View style={{ flex: 1, paddingRight: space.md }}>
          <Text style={s.switchTitle}>Simplify debts</Text>
          <Text style={s.switchBody}>
            Combine what everyone owes so the group settles with the fewest payments. If Arjun owes Ravi and Ravi owes
            you, Arjun can pay you directly.
          </Text>
        </View>
        <Switch
          value={simplify}
          onValueChange={setSimplify}
          trackColor={{ true: colors.star, false: colors.line }}
          thumbColor={colors.text}
          // react-native-web uses its own prop names for the "on" colours
          {...({ activeThumbColor: colors.text, activeTrackColor: colors.star } as object)}
        />
      </View>

      {existing ? (
        <View style={{ marginTop: space.xl }}>
          <ConfirmButton
            title="Delete group"
            confirmTitle="Tap again to delete the group and all its expenses"
            onConfirm={() => {
              dispatch({ type: 'deleteGroup', id: existing.id });
              navigation.popToTop();
            }}
          />
          {hasBalance ? (
            <Text style={[ui.hint, { textAlign: 'center' }]}>Some balances in this group aren't settled yet.</Text>
          ) : null}
        </View>
      ) : null}

      <CurrencyPicker
        visible={picker === 'base'}
        title="Main currency"
        options={CURRENCY_CODES}
        selected={base}
        onSelect={changeBase}
        onClose={() => setPicker(null)}
      />
      <CurrencyPicker
        visible={picker === 'add'}
        title="Add a currency"
        options={CURRENCY_CODES.filter((c) => c !== base && !extras.includes(c))}
        onSelect={addCurrency}
        onClose={() => setPicker(null)}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  addRow: { flexDirection: 'row', gap: space.sm, marginTop: space.md, alignItems: 'center' },
  curRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 12, paddingHorizontal: space.lg },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  link: { color: colors.star, fontSize: 14, fontWeight: '600' },
  remove: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  rateLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  rateText: { fontFamily: fonts.medium, fontSize: 14, color: colors.textSoft },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: space.xl,
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  switchTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  switchBody: { fontSize: 13, color: colors.muted, marginTop: 4, lineHeight: 18 },
});
