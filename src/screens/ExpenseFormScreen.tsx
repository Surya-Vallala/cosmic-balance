import React, { useLayoutEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { computePayers, computeSplit, groupCurrencies, toBase } from '../logic';
import { formatMoney, paiseToInput, parseRupees } from '../money';
import type { ScreenProps } from '../navigation';
import { uid, useName, useStore } from '../store';
import { colors, fonts, space } from '../theme';
import type { CurrencyCode, SplitType } from '../types';
import {
  AmountInput,
  Avatar,
  Button,
  Chip,
  ConfirmButton,
  CurrencyButton,
  CurrencyPicker,
  Field,
  List,
  rateText,
  Screen,
  Segmented,
  SmallInput,
  styles as ui,
  symbolPrefix,
} from '../ui';

const splitHelp: Record<SplitType, string> = {
  equal: 'Tick who shared this. The amount is divided equally between them.',
  exact: 'Type exactly how much each person owes. It must add up to the total.',
  percent: 'Give each person a percentage. It must add up to 100%.',
  shares: 'Give each person a number of shares, for example 2 for a couple and 1 for everyone else.',
};

export default function ExpenseFormScreen({ navigation, route }: ScreenProps<'ExpenseForm'>) {
  const { state, dispatch } = useStore();
  const nameOf = useName();
  const meId = state.meId!;
  const group = state.groups.find((g) => g.id === route.params.groupId);
  const existing = state.expenses.find((e) => e.id === route.params.expenseId);
  const members = group?.memberIds ?? [];
  const currencies = group ? groupCurrencies(group) : ['INR'];

  const [description, setDescription] = useState(existing?.description ?? '');
  const [cur, setCur] = useState<CurrencyCode>(existing?.currency ?? group?.baseCurrency ?? 'INR');
  const [pickCurrency, setPickCurrency] = useState(false);
  const [amountText, setAmountText] = useState(existing ? paiseToInput(existing.amount) : '');
  const existingPayers = Object.entries(existing?.payers ?? {});
  const [multiPay, setMultiPay] = useState(existingPayers.length > 1);
  const [paidBy, setPaidBy] = useState(existingPayers.length === 1 ? existingPayers[0][0] : meId);
  const [payerInputs, setPayerInputs] = useState<Record<string, string>>(
    existingPayers.length > 1 ? Object.fromEntries(existingPayers.map(([id, p]) => [id, paiseToInput(p)])) : {},
  );
  const [splitType, setSplitType] = useState<SplitType>(existing?.splitType ?? 'equal');
  const [selected, setSelected] = useState<string[]>(existing?.splitType === 'equal' ? existing.participants : members);
  const [inputs, setInputs] = useState<Record<string, string>>(existing?.splitType !== 'equal' ? existing?.inputs ?? {} : {});
  const [touched, setTouched] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({ title: existing ? 'Edit expense' : 'Add expense' });
  }, [navigation, existing]);

  const amount = parseRupees(amountText);
  const participants = splitType === 'equal' ? members.filter((m) => selected.includes(m)) : members;
  const result = useMemo(
    () => (amount ? computeSplit(amount, splitType, participants, inputs, cur) : null),
    [amount, splitType, participants.join(','), inputs, cur],
  );

  const payerResult = multiPay && amount ? computePayers(amount, members, payerInputs, cur) : null;
  const payers: Record<string, number> | null = multiPay
    ? payerResult?.ok
      ? payerResult.payers
      : null
    : amount
      ? { [paidBy]: amount }
      : null;

  if (!group) return null;

  const switchType = (t: SplitType) => {
    setSplitType(t);
    // Pre-fill sensible starting values so the user only adjusts.
    if (t === 'shares') setInputs(Object.fromEntries(members.map((m) => [m, '1'])));
    else if (t === 'percent') {
      const each = Math.floor(10000 / members.length) / 100;
      const vals = members.map((_, i) => (i === 0 ? +(100 - each * (members.length - 1)).toFixed(2) : each));
      setInputs(Object.fromEntries(members.map((m, i) => [m, String(vals[i])])));
    } else if (t === 'exact') setInputs({});
  };

  const descError = touched && !description.trim() ? 'Say what this was for.' : null;
  const amountError =
    touched && amount === null
      ? 'Enter the total, like 450 or 1250.50.'
      : touched && amount === 0
        ? 'Enter an amount above zero.'
        : null;

  const canSave = !!description.trim() && !!amount && !!result?.ok && !!payers;

  const save = () => {
    setTouched(true);
    if (!canSave || !result?.ok || !amount || !payers) return;
    dispatch({
      type: 'saveExpense',
      expense: {
        id: existing?.id ?? uid(),
        groupId: group.id,
        description: description.trim(),
        currency: cur,
        amount,
        payers,
        splitType,
        participants: Object.keys(result.shares),
        inputs: splitType === 'equal' ? {} : inputs,
        shares: result.shares,
        date: existing?.date ?? new Date().toISOString(),
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      },
    });
    navigation.goBack();
  };

  const shareOf = (id: string) => (result?.ok ? result.shares[id] ?? 0 : null);
  const money = (v: number) => formatMoney(v, cur);
  const prefix = symbolPrefix(cur);

  return (
    <Screen footer={<Button title={existing ? 'Save changes' : 'Add expense'} onPress={save} disabled={touched && !canSave} />}>
      <Field
        label="What was it for?"
        value={description}
        onChangeText={setDescription}
        placeholder="Dinner, cab, groceries…"
        autoCapitalize="sentences"
        error={descError}
      />

      <Text style={ui.label}>Total amount</Text>
      <AmountInput
        code={cur}
        onPressCurrency={currencies.length > 1 ? () => setPickCurrency(true) : undefined}
        value={amountText}
        onChangeText={setAmountText}
        invalid={!!(amountError)}
        accessibilityLabel="Total amount"
        fontSize={40}
      />
      {amountError ? <Text style={ui.error}>{amountError}</Text> : null}
      {cur !== group.baseCurrency && amount ? (
        <Text style={ui.hint}>
          About {formatMoney(toBase(group, amount, cur), group.baseCurrency)} at {rateText(group, cur)}
        </Text>
      ) : currencies.length > 1 ? (
        <Text style={ui.hint}>Tap the currency to switch between {currencies.join(' and ')}.</Text>
      ) : null}

      <Text style={[ui.label, { marginTop: space.xl }]}>Paid by</Text>
      <View style={s.chips}>
        {members.map((m) => (
          <Chip
            key={m}
            label={nameOf(m)}
            selected={!multiPay && paidBy === m}
            onPress={() => {
              setPaidBy(m);
              setMultiPay(false);
            }}
            leading={<Avatar name={state.people[m]?.name ?? '?'} size={20} />}
          />
        ))}
        <Chip
          label="Multiple people"
          selected={multiPay}
          onPress={() => setMultiPay(true)}
          leading={<Text style={[s.multiIcon, multiPay && { color: colors.space }]}>+</Text>}
        />
      </View>

      {multiPay ? (
        <>
          <Text style={[ui.hint, { marginBottom: space.md }]}>
            Type how much each person paid. Leave it blank for anyone who didn't pay.
          </Text>
          <List>
            {members.map((m, i) => (
              <View key={m} style={[s.memberRow, i < members.length - 1 && s.divider]}>
                <Avatar name={state.people[m]?.name ?? '?'} size={32} />
                <Text style={s.memberName}>{nameOf(m)}</Text>
                <Text style={s.prefix}>{prefix}</Text>
                <SmallInput
                  value={payerInputs[m] ?? ''}
                  onChangeText={(v) => setPayerInputs({ ...payerInputs, [m]: v })}
                  accessibilityLabel={`Amount ${nameOf(m)} paid`}
                />
              </View>
            ))}
          </List>
          {!amount ? (
            <Text style={[s.status, { color: colors.muted }]}>Enter the total above first.</Text>
          ) : payerResult?.ok ? (
            <Text style={[s.status, { color: colors.owed }]}>
              Paid by {Object.keys(payerResult.payers).length}{' '}
              {Object.keys(payerResult.payers).length === 1 ? 'person' : 'people'}, adds up to {money(amount)}.
            </Text>
          ) : payerResult ? (
            <Text style={[s.status, { color: colors.owe }]}>{payerResult.error}</Text>
          ) : null}
        </>
      ) : null}

      <Text style={[ui.label, { marginTop: space.xl }]}>Split</Text>
      <Segmented<SplitType>
        value={splitType}
        onChange={switchType}
        options={[
          { value: 'equal', label: 'Equally' },
          { value: 'exact', label: 'Amounts' },
          { value: 'percent', label: 'Percent' },
          { value: 'shares', label: 'Shares' },
        ]}
      />
      <Text style={[ui.hint, { marginBottom: space.md }]}>{splitHelp[splitType]}</Text>

      <List>
        {members.map((m, i) => {
          const share = shareOf(m);
          const last = i === members.length - 1;
          if (splitType === 'equal') {
            const on = selected.includes(m);
            return (
              <Pressable
                key={m}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() => setSelected(on ? selected.filter((x) => x !== m) : [...selected, m])}
                style={[s.memberRow, !last && s.divider]}
              >
                <View style={[s.check, on && s.checkOn]}>{on ? <Text style={s.checkMark}>✓</Text> : null}</View>
                <Avatar name={state.people[m]?.name ?? '?'} size={32} />
                <Text style={s.memberName}>{nameOf(m)}</Text>
                <Text style={s.memberShare}>{on && share !== null ? money(share) : ''}</Text>
              </Pressable>
            );
          }
          const suffix = splitType === 'percent' ? '%' : splitType === 'shares' ? 'shares' : '';
          return (
            <View key={m} style={[s.memberRow, !last && s.divider]}>
              <Avatar name={state.people[m]?.name ?? '?'} size={32} />
              <View style={{ flex: 1, marginLeft: space.md }}>
                <Text style={[s.memberName, { marginLeft: 0 }]}>{nameOf(m)}</Text>
                {splitType !== 'exact' && share !== null ? <Text style={s.computed}>{money(share)}</Text> : null}
              </View>
              {splitType === 'exact' ? <Text style={s.prefix}>{prefix}</Text> : null}
              <SmallInput
                value={inputs[m] ?? ''}
                onChangeText={(v) => setInputs({ ...inputs, [m]: v })}
                accessibilityLabel={`${nameOf(m)} ${splitType === 'exact' ? 'amount' : suffix}`}
              />
              {suffix ? <Text style={s.suffix}>{suffix}</Text> : null}
            </View>
          );
        })}
      </List>

      {amount ? (
        result?.ok ? (
          <Text style={[s.status, { color: colors.owed }]}>
            Split between {Object.keys(result.shares).length}{' '}
            {Object.keys(result.shares).length === 1 ? 'person' : 'people'}, adds up to {money(amount)}.
          </Text>
        ) : result ? (
          <Text style={[s.status, { color: colors.owe }]}>{result.error}</Text>
        ) : null
      ) : null}

      {existing ? (
        <View style={{ marginTop: space.xxl }}>
          <ConfirmButton
            title="Delete expense"
            confirmTitle="Tap again to delete"
            onConfirm={() => {
              dispatch({ type: 'deleteExpense', id: existing.id });
              navigation.goBack();
            }}
          />
        </View>
      ) : null}

      <CurrencyPicker
        visible={pickCurrency}
        title="Currency for this expense"
        options={currencies}
        selected={cur}
        onSelect={setCur}
        onClose={() => setPickCurrency(false)}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  amountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 18,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  amountInput: {
    flex: 1,
    minWidth: 0,
    fontFamily: fonts.light,
    fontSize: 40,
    color: colors.text,
    paddingVertical: 6,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.sm },
  multiIcon: { fontSize: 18, lineHeight: 20, fontWeight: '700', color: colors.text, width: 20, textAlign: 'center' },
  memberRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: space.lg, minHeight: 56 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  check: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.muted,
    marginRight: space.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.text, borderColor: colors.text },
  checkMark: { color: colors.space, fontSize: 14, fontWeight: '700' },
  memberName: { flex: 1, fontSize: 16, color: colors.text, fontWeight: '500', marginLeft: space.md },
  memberShare: { fontFamily: fonts.medium, fontSize: 15, color: colors.text },
  computed: { fontSize: 13, color: colors.muted, marginTop: 1 },
  prefix: { fontSize: 15, color: colors.muted, marginRight: 6 },
  suffix: { fontSize: 13, color: colors.muted, marginLeft: 6, width: 42 },
  status: { fontSize: 14, fontWeight: '600', marginTop: space.md, marginHorizontal: space.xs },
});
