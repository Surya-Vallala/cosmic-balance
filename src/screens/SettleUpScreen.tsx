import React, { useEffect, useState } from 'react';
import { Linking, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { Pulsar, Supernova } from '../cosmos';
import { relativeDay } from '../dates';
import { fromBase, groupCurrencies, toBase } from '../logic';
import { formatMoney, paiseToDecimalString, paiseToInput, parseRupees } from '../money';
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
  CurrencyButton,
  CurrencyPicker,
  equivalents,
  rateText,
  Screen,
  styles as ui,
} from '../ui';

export default function SettleUpScreen({ navigation, route }: ScreenProps<'SettleUp'>) {
  const { state, dispatch } = useStore();
  const nameOf = useName();
  const meId = state.meId!;
  const { groupId, paymentId } = route.params;
  const group = state.groups.find((g) => g.id === groupId);
  const members = group?.memberIds ?? [];
  const base = group?.baseCurrency ?? 'INR';
  const suggestedBase = route.params.amount; // what's owed, in the main currency

  const [from, setFrom] = useState(route.params.from ?? meId);
  const [to, setTo] = useState(route.params.to ?? members.find((m) => m !== (route.params.from ?? meId)) ?? '');
  const [cur, setCur] = useState<CurrencyCode>(base);
  const [pickCurrency, setPickCurrency] = useState(false);
  const [amountText, setAmountText] = useState(suggestedBase ? paiseToInput(suggestedBase) : '');
  const [edited, setEdited] = useState(false);
  const [touched, setTouched] = useState(false);
  const [upiMessage, setUpiMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => navigation.goBack(), 1200);
    return () => clearTimeout(t);
  }, [done, navigation]);

  if (done) {
    return (
      <View style={s.done}>
        <Supernova size={150} burst />
        <Text style={s.doneText}>Payment recorded</Text>
      </View>
    );
  }

  // Viewing an existing payment
  if (paymentId) {
    const p = state.payments.find((x) => x.id === paymentId);
    if (!p) return <Screen><Text style={s.big}>This payment was deleted.</Text></Screen>;
    return (
      <Screen>
        <View style={s.pair}>
          <Avatar name={state.people[p.from]?.name ?? '?'} size={56} />
          <View style={s.pairLine} />
          <Avatar name={state.people[p.to]?.name ?? '?'} size={56} />
        </View>
        <Text style={s.big}>
          {nameOf(p.from)} paid {p.to === meId ? 'you' : nameOf(p.to)} {formatMoney(p.amount, p.currency)}
        </Text>
        {group && p.currency !== group.baseCurrency ? (
          <Text style={s.meta}>Worth {formatMoney(p.baseAmount, group.baseCurrency)} when it was recorded</Text>
        ) : null}
        <Text style={s.meta}>
          {relativeDay(p.date)} in {group?.name ?? 'a deleted group'}
        </Text>
        {p.settlementId ? (
          <View style={{ marginTop: space.xxl }}>
            <Text style={[s.meta, { marginBottom: space.md }]}>
              This was written by an overall settle-up between {nameOf(p.from)} and {p.to === meId ? 'you' : nameOf(p.to)}.
              To undo it, delete that settle-up.
            </Text>
            <Button
              title="Open the overall settle-up"
              variant="secondary"
              onPress={() => navigation.navigate('Transfer', { transferId: p.settlementId })}
            />
          </View>
        ) : (
          <View style={{ marginTop: space.xxl }}>
            <ConfirmButton
              title="Delete payment"
              confirmTitle="Tap again to delete"
              onConfirm={() => {
                dispatch({ type: 'deletePayment', id: p.id });
                navigation.goBack();
              }}
            />
          </View>
        )}
      </Screen>
    );
  }

  if (!group) return null;

  const currencies = groupCurrencies(group);
  const amount = parseRupees(amountText);
  const payee = state.people[to];
  const samePerson = from === to;
  const amountError = touched && !amount ? 'Enter how much was paid.' : null;
  const valid = !!amount && !!to && !samePerson;
  const suggestionIn = (c: CurrencyCode) => (suggestedBase ? fromBase(group, suggestedBase, c) : null);

  const chooseCurrency = (c: CurrencyCode, forceSuggestion = false) => {
    setCur(c);
    const sug = suggestionIn(c);
    if (sug !== null && (!edited || forceSuggestion)) {
      setAmountText(paiseToInput(sug));
      setEdited(false);
    }
  };

  // What this payment is worth in the main currency. If the suggested amount
  // is paid unchanged, it settles the balance exactly, with no rounding left.
  const baseAmountOf = (amt: number) =>
    !edited && suggestedBase && amt === suggestionIn(cur) ? suggestedBase : toBase(group, amt, cur);

  const record = () => {
    setTouched(true);
    if (!valid || !amount) return;
    dispatch({
      type: 'addPayment',
      payment: {
        id: uid(),
        groupId: group.id,
        from,
        to,
        currency: cur,
        amount,
        baseAmount: baseAmountOf(amount),
        date: new Date().toISOString(),
      },
    });
    setDone(true);
  };

  const payWithUpi = async () => {
    if (!payee?.upiId || !amount) return;
    const params = [
      `pa=${encodeURIComponent(payee.upiId)}`,
      `pn=${encodeURIComponent(payee.name)}`,
      `am=${paiseToDecimalString(amount)}`,
      'cu=INR',
      `tn=${encodeURIComponent(`${group.name} (Cosmic Khaata)`)}`,
    ].join('&');
    try {
      await Linking.openURL(`upi://pay?${params}`);
      setUpiMessage('After paying in your UPI app, come back and tap Record payment.');
    } catch {
      setUpiMessage("Couldn't open a UPI app on this device. Pay another way, then record it here.");
    }
  };

  const sendReminder = async () => {
    const me = state.people[meId];
    const payer = state.people[from];
    if (!payer || !amount) return;
    const baseAmt = baseAmountOf(amount);
    const other =
      currencies.length > 1
        ? cur === base
          ? ` (or ${equivalents(group, baseAmt)})`
          : ` (about ${formatMoney(baseAmt, base)})`
        : '';
    const upiLine = me?.upiId ? ` You can pay me on UPI at ${me.upiId}.` : '';
    try {
      await Share.share({
        message: `Hi ${payer.name}, a quick reminder: you owe me ${formatMoney(amount, cur)}${other} for ${group.name}.${upiLine}`,
      });
    } catch {
      // Sharing was cancelled or isn't available; nothing to do.
    }
  };

  return (
    <Screen footer={<Button title="Record payment" onPress={record} disabled={touched && !valid} />}>
      <Text style={ui.label}>Who paid</Text>
      <View style={s.chips}>
        {members.map((m) => (
          <Chip
            key={m}
            label={nameOf(m)}
            selected={from === m}
            onPress={() => setFrom(m)}
            leading={<Avatar name={state.people[m]?.name ?? '?'} size={20} />}
          />
        ))}
      </View>

      <Text style={[ui.label, { marginTop: space.xl }]}>Who received it</Text>
      <View style={s.chips}>
        {members.map((m) => (
          <Chip
            key={m}
            label={nameOf(m)}
            selected={to === m}
            onPress={() => setTo(m)}
            leading={<Avatar name={state.people[m]?.name ?? '?'} size={20} />}
          />
        ))}
      </View>
      {samePerson ? <Text style={ui.error}>Pick two different people.</Text> : null}

      {suggestedBase && currencies.length > 1 ? (
        <>
          <Text style={[ui.label, { marginTop: space.xl }]}>Amount owed</Text>
          <View style={s.chips}>
            {currencies.map((c) => (
              <Chip
                key={c}
                label={formatMoney(suggestionIn(c)!, c)}
                selected={cur === c && !edited}
                onPress={() => chooseCurrency(c, true)}
              />
            ))}
          </View>
          <Text style={ui.hint}>Settle in whichever currency suits you. Tap one to use it.</Text>
        </>
      ) : null}

      <Text style={[ui.label, { marginTop: space.xl }]}>Amount paid</Text>
      <AmountInput
        code={cur}
        onPressCurrency={currencies.length > 1 ? () => setPickCurrency(true) : undefined}
        value={amountText}
        onChangeText={(v) => {
            setAmountText(v);
            setEdited(true);
          }}
        invalid={!!(amountError)}
        accessibilityLabel="Amount paid"
        fontSize={34}
      />
      {amountError ? (
        <Text style={ui.error}>{amountError}</Text>
      ) : cur !== base && amount ? (
        <Text style={ui.hint}>
          Worth {formatMoney(baseAmountOf(amount), base)} at {rateText(group, cur)}
        </Text>
      ) : suggestedBase && currencies.length === 1 ? (
        <Text style={ui.hint}>Suggested from the group's balances: {formatMoney(suggestedBase, base)}</Text>
      ) : null}

      {from === meId && to && !samePerson ? (
        payee?.upiId ? (
          cur === 'INR' ? (
            <View style={s.panel}>
              <Text style={s.panelTitle}>Pay {payee.name} with UPI</Text>
              <Text style={s.panelBody}>
                Opens your UPI app (GPay, PhonePe, Paytm…) with {payee.upiId} and the amount filled in.
              </Text>
              <Button
                title={amount ? `Pay ${formatMoney(amount, 'INR')} in UPI app` : 'Pay in UPI app'}
                variant="secondary"
                disabled={!amount}
                onPress={payWithUpi}
                style={{ marginTop: space.md }}
              />
              {upiMessage ? <Text style={[ui.hint, { marginTop: space.sm }]}>{upiMessage}</Text> : null}
            </View>
          ) : currencies.includes('INR') ? (
            <Text style={[ui.hint, { marginTop: space.lg }]}>UPI only works in rupees. Switch to ₹ to pay {payee.name} with UPI.</Text>
          ) : null
        ) : cur === 'INR' ? (
          <Text style={[ui.hint, { marginTop: space.lg }]} onPress={() => navigation.navigate('FriendForm', { personId: to })}>
            Add {nameOf(to)}'s UPI ID to pay them straight from here. <Text style={s.link}>Add UPI ID</Text>
          </Text>
        ) : null
      ) : null}

      {to === meId && from !== meId ? (
        <View style={s.panel}>
          <View style={s.panelHead}>
            <Pulsar size={30} />
            <Text style={s.panelTitle}>Waiting on {nameOf(from)}?</Text>
          </View>
          <Text style={s.panelBody}>
            Send a friendly reminder on WhatsApp or any other app
            {state.people[meId]?.upiId ? ', with your UPI ID included' : ''}.
          </Text>
          <Button
            title="Send a reminder"
            variant="secondary"
            disabled={!amount}
            onPress={sendReminder}
            style={{ marginTop: space.md }}
          />
        </View>
      ) : null}

      <Text style={[ui.hint, { marginTop: space.xl }]}>
        Recording a payment only updates balances in Cosmic Khaata. It doesn't move any money.
      </Text>

      <CurrencyPicker
        visible={pickCurrency}
        title="Currency for this payment"
        options={currencies}
        selected={cur}
        onSelect={(c) => chooseCurrency(c)}
        onClose={() => setPickCurrency(false)}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  pair: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.md, marginVertical: space.xl },
  pairLine: { width: 48, height: 1, backgroundColor: colors.star },
  big: { fontFamily: fonts.light, fontSize: 24, color: colors.text, textAlign: 'center', lineHeight: 32 },
  meta: { fontSize: 14, color: colors.muted, textAlign: 'center', marginTop: space.sm },
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
  amountInput: { flex: 1, minWidth: 0, fontFamily: fonts.light, fontSize: 34, color: colors.text, paddingVertical: 6 },
  panel: {
    marginTop: space.xl,
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    padding: space.lg,
  },
  panelTitle: { fontFamily: fonts.medium, fontSize: 16, color: colors.text },
  panelBody: { fontSize: 14, color: colors.textSoft, marginTop: 4, lineHeight: 20 },
  link: { color: colors.star, fontWeight: '700' },
  panelHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  done: { flex: 1, backgroundColor: colors.space, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  doneText: { fontFamily: fonts.light, fontSize: 24, color: colors.text, marginTop: space.xl },
});
