import React, { useLayoutEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { fromDay, relativeDay, toDay } from '../dates';
import { CURRENCY_CODES, formatMoney, paiseToInput, parseRupees } from '../money';
import type { ScreenProps } from '../navigation';
import { uid, useName, useStore } from '../store';
import { colors, fonts, space } from '../theme';
import type { CurrencyCode } from '../types';
import {
  AmountInput,
  Avatar,
  Button,
  Chip,
  ConfirmButton,
  CurrencyPicker,
  DateField,
  Empty,
  Field,
  List,
  Row,
  Screen,
  styles as ui,
} from '../ui';

export default function TransferScreen({ navigation, route }: ScreenProps<'Transfer'>) {
  const { state, dispatch } = useStore();
  const nameOf = useName();
  const meId = state.meId!;
  const existing = state.transfers.find((t) => t.id === route.params.transferId);

  const people = [
    meId,
    ...Object.keys(state.people)
      .filter((id) => id !== meId && !state.people[id].requesting)
      .sort((a, b) => nameOf(a).localeCompare(nameOf(b))),
  ];
  const firstFriend = people.find((id) => id !== meId) ?? '';

  const [from, setFrom] = useState(existing?.from ?? route.params.from ?? meId);
  const [to, setTo] = useState(existing?.to ?? route.params.to ?? (route.params.from && route.params.from !== meId ? meId : firstFriend));
  const [cur, setCur] = useState<CurrencyCode>(existing?.currency ?? 'INR');
  const [pick, setPick] = useState(false);
  const [amountText, setAmountText] = useState(existing ? paiseToInput(existing.amount) : '');
  const [note, setNote] = useState(existing?.note ?? '');
  // The day the money was given: today unless changed.
  const [day, setDay] = useState(() => toDay(existing?.date ?? new Date()));
  const [touched, setTouched] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: existing?.kind === 'settlement' ? 'Overall settle-up' : existing ? 'Edit transfer' : 'Transfer money',
    });
  }, [navigation, existing]);

  // An overall settle-up is shown, not edited: it also cleared group balances.
  if (existing?.kind === 'settlement') {
    const cleared = state.payments.filter((p) => p.settlementId === existing.id);
    return (
      <Screen>
        <Text style={s.big}>
          {nameOf(existing.from)} paid {existing.to === meId ? 'you' : nameOf(existing.to)}{' '}
          {formatMoney(existing.amount, existing.currency)}
        </Text>
        <Text style={s.meta}>{relativeDay(existing.date)}, settling everything between them</Text>
        {cleared.length > 0 ? (
          <>
            <Text style={[ui.label, { marginTop: space.xl }]}>Groups it cleared</Text>
            <List>
              {cleared.map((p, i) => {
                const g = state.groups.find((x) => x.id === p.groupId);
                return (
                  <Row
                    key={p.id}
                    title={g?.name ?? 'Deleted group'}
                    subtitle={`${nameOf(p.from)} to ${p.to === meId ? 'you' : nameOf(p.to)}, ${formatMoney(p.baseAmount, g?.baseCurrency ?? existing.currency)}`}
                    last={i === cleared.length - 1}
                  />
                );
              })}
            </List>
          </>
        ) : null}
        <View style={{ marginTop: space.xxl }}>
          <ConfirmButton
            title="Delete this settle-up"
            confirmTitle="Tap again: groups go back to unsettled"
            onConfirm={() => {
              dispatch({ type: 'deleteTransfer', id: existing.id });
              navigation.goBack();
            }}
          />
        </View>
      </Screen>
    );
  }

  if (people.length < 2) {
    return (
      <Screen>
        <Empty
          title="Add a friend first"
          body="Transfers are between you and a friend. Add someone, then come back."
          action={<Button title="Add a friend" onPress={() => navigation.replace('FriendForm', {})} />}
        />
      </Screen>
    );
  }

  const amount = parseRupees(amountText);
  const same = from === to;
  const valid = !!amount && !same && !!to;

  const save = () => {
    setTouched(true);
    if (!valid || !amount) return;
    dispatch({
      type: 'saveTransfer',
      transfer: {
        id: existing?.id ?? uid(),
        kind: 'transfer',
        from,
        to,
        currency: cur,
        amount,
        note: note.trim() || undefined,
        date: fromDay(day, existing?.date),
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      },
    });
    navigation.goBack();
  };

  const chooser = (value: string, onChange: (v: string) => void) => (
    <View style={s.chips}>
      {people.map((id) => (
        <Chip
          key={id}
          label={nameOf(id)}
          selected={value === id}
          onPress={() => onChange(id)}
          leading={<Avatar name={state.people[id]?.name ?? '?'} size={20} />}
        />
      ))}
    </View>
  );

  return (
    <Screen footer={<Button title={existing ? 'Save changes' : 'Save transfer'} onPress={save} disabled={touched && !valid} />}>
      <Text style={s.intro}>
        Money given from one person to another, outside any group: cash, a UPI transfer, a loan. It counts in your overall
        balance with each other.
      </Text>

      <Text style={[ui.label, { marginTop: space.xl }]}>Who gave the money</Text>
      {chooser(from, setFrom)}

      <Text style={[ui.label, { marginTop: space.xl }]}>Who received it</Text>
      {chooser(to, setTo)}
      {same ? <Text style={ui.error}>Pick two different people.</Text> : null}

      <Text style={[ui.label, { marginTop: space.xl }]}>Amount</Text>
      <AmountInput
        code={cur}
        onPressCurrency={() => setPick(true)}
        value={amountText}
        onChangeText={setAmountText}
        invalid={!!(touched && !amount)}
        accessibilityLabel="Amount"
        fontSize={36}
      />
      {touched && !amount ? <Text style={ui.error}>Enter how much was given.</Text> : null}

      <View style={{ marginTop: space.lg }}>
        <DateField label="Date" value={day} onChange={setDay} />
      </View>

      <View style={{ marginTop: space.xl }}>
        <Field
          label="What was it for? (optional)"
          value={note}
          onChangeText={setNote}
          placeholder="Cash, concert tickets, rent advance…"
          autoCapitalize="sentences"
        />
      </View>

      {amount && !same && to ? (
        <Text style={s.effect}>
          {to === meId ? `You owe ${nameOf(from)}` : `${nameOf(to)} owes ${from === meId ? 'you' : nameOf(from)}`}{' '}
          {formatMoney(amount, cur)} more after this.
        </Text>
      ) : null}

      {existing ? (
        <View style={{ marginTop: space.xl }}>
          <ConfirmButton
            title="Delete transfer"
            confirmTitle="Tap again to delete"
            onConfirm={() => {
              dispatch({ type: 'deleteTransfer', id: existing.id });
              navigation.goBack();
            }}
          />
        </View>
      ) : null}

      <CurrencyPicker
        visible={pick}
        title="Currency"
        options={CURRENCY_CODES}
        selected={cur}
        onSelect={setCur}
        onClose={() => setPick(false)}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  intro: { fontSize: 14, lineHeight: 20, color: colors.textSoft },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
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
  amountInput: { flex: 1, minWidth: 0, fontFamily: fonts.light, fontSize: 36, color: colors.text, paddingVertical: 6 },
  effect: { fontSize: 13, color: colors.muted, lineHeight: 19 },
  big: { fontFamily: fonts.light, fontSize: 24, color: colors.text, lineHeight: 32, marginTop: space.lg },
  meta: { fontSize: 14, color: colors.muted, marginTop: space.sm },
});
