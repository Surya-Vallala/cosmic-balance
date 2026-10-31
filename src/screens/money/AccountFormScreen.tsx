// Adding or editing one of your accounts: its name, type, currency and the
// balance it starts from.
import React, { useLayoutEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CURRENCY_CODES, currency, formatMoney, paiseToInput, parseRupees } from '../../money';
import type { ScreenProps } from '../../navigation';
import { accountInUse } from '../../pfm/data';
import { useMoney } from '../../pfm/store';
import { ACCOUNT_TYPES, accountType, type Account, type AccountType } from '../../pfm/types';
import { uid } from '../../store';
import { colors, space } from '../../theme';
import { Button, Chip, ConfirmButton, CurrencyButton, CurrencyPicker, Field, Screen, styles as ui } from '../../ui';

const NOTE_HINT: Partial<Record<AccountType, string>> = {
  card: 'Bill due on the 12th',
  loan: 'EMI ₹11,500 on the 5th',
  investment: 'Matures 4 Mar 2027',
  lent: 'Who has it, and when it comes back',
  travel: 'Loaded for the Thailand trip',
};

/** The balance box as typed: "1,250.50", or "-300" for a negative one. */
function toInput(v: number): string {
  if (!v) return '';
  return `${v < 0 ? '-' : ''}${paiseToInput(Math.abs(v))}`;
}

function parseSigned(input: string): number | null {
  const t = input.trim();
  if (!t) return 0;
  const neg = /^[-−]/.test(t);
  const v = parseRupees(t.replace(/^[-−]\s*/, ''));
  return v === null ? null : neg ? -v : v;
}

export default function AccountFormScreen({ navigation, route }: ScreenProps<'AccountForm'>) {
  const { m, balances, saveAccount, removeAccount } = useMoney();
  const existing = route.params?.accountId ? m.accounts[route.params.accountId] : undefined;
  const inUse = existing ? accountInUse(m, existing.id) : false;

  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState<AccountType>(existing?.type ?? 'bank');
  const [code, setCode] = useState(existing?.currency ?? m.settings.currency);
  const owed = !!accountType(type).owed;
  // Cards and loans: what you owe is typed as a positive amount.
  const [amount, setAmount] = useState(() => toInput(existing ? (accountType(existing.type).owed ? -existing.opening : existing.opening) : 0));
  const [note, setNote] = useState(existing?.note ?? '');
  const [picker, setPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({ title: existing ? 'Edit account' : 'New account' });
  }, [navigation, existing]);

  const parsed = parseSigned(amount);
  const trimmed = name.trim();
  const clash = Object.values(m.accounts).find(
    (a) => a.id !== existing?.id && !a.hidden && a.name.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  const nameError = touched && !trimmed ? 'Give it a name' : clash ? `You already have an account called ${clash.name}` : null;
  const amountError = parsed === null ? 'Enter an amount like 1,250 or 1250.50' : null;

  const save = () => {
    setTouched(true);
    if (!trimmed || clash || parsed === null) {
      setError(!trimmed ? 'Give it a name.' : null);
      return;
    }
    const opening = owed ? -parsed : parsed;
    const sameType = Object.values(m.accounts).filter((a) => a.type === type && a.id !== existing?.id);
    const a: Account = existing
      ? {
          ...existing,
          name: trimmed,
          type,
          currency: code,
          opening,
          note: note.trim() || undefined,
          // Moved to another type: last in its new list.
          order: existing.type === type ? existing.order : sameType.reduce((x, y) => Math.max(x, y.order + 1), 0),
        }
      : {
          id: uid(),
          name: trimmed,
          type,
          currency: code,
          opening,
          note: note.trim() || undefined,
          order: sameType.reduce((x, y) => Math.max(x, y.order + 1), 0),
          createdAt: new Date().toISOString(),
        };
    saveAccount(a);
    navigation.goBack();
  };

  const balanceNow = existing ? balances[existing.id] ?? existing.opening : 0;
  const balanceLabel = existing ? (owed ? 'Amount owed when you added it' : 'Starting balance') : owed ? 'Amount owed now' : 'Balance now';
  const balanceHint = existing
    ? `Its balance now is ${formatMoney(balanceNow, existing.currency, { sign: balanceNow < 0 })}. Changing this moves it by the same amount.`
    : owed
      ? 'What you owe on it today (the unpaid bill or loan). Leave it empty if nothing.'
      : 'What’s in it today. Everything you record from now on adds to or takes from this.';

  return (
    <Screen
      footer={<Button title={existing ? 'Save' : 'Add account'} onPress={save} accessibilityLabel={existing ? 'Save account' : 'Add account'} />}
    >
      {existing?.hidden ? (
        <View style={st.deleted}>
          <Text style={st.deletedText}>You deleted this account. Bring it back to use it again.</Text>
          <Button
            small
            title="Bring back"
            variant="secondary"
            onPress={() => {
              saveAccount({ ...existing, hidden: false });
              navigation.goBack();
            }}
          />
        </View>
      ) : null}

      <Field
        label="Name"
        value={name}
        onChangeText={(v) => {
          setName(v);
          setError(null);
        }}
        onBlur={() => setTouched(true)}
        placeholder={type === 'card' ? 'Amazon ICICI' : type === 'cash' ? 'Cash' : type === 'wallet' ? 'Paytm wallet' : 'HDFC Savings'}
        maxLength={40}
        error={nameError ?? error}
        accessibilityLabel="Account name"
        autoFocus={!existing}
      />

      <Text style={ui.label}>Type</Text>
      <View style={st.chips}>
        {ACCOUNT_TYPES.map((t) => (
          <Chip key={t.id} label={t.one} selected={type === t.id} onPress={() => setType(t.id)} />
        ))}
      </View>

      <Text style={ui.label}>Currency</Text>
      <View style={[st.currencyRow, { marginBottom: space.lg }]}>
        <CurrencyButton code={code} onPress={inUse ? undefined : () => setPicker(true)} large />
        <Text style={st.currencyName}>{currency(code).name}</Text>
      </View>
      {inUse ? (
        <Text style={[ui.hint, { marginTop: -space.md, marginBottom: space.lg }]}>Its currency can’t change once it has transactions.</Text>
      ) : null}

      <Field
        label={balanceLabel}
        value={amount}
        onChangeText={setAmount}
        keyboardType="numbers-and-punctuation"
        inputMode="decimal"
        placeholder="0"
        hint={balanceHint}
        error={amountError}
        accessibilityLabel={balanceLabel}
      />

      <Field
        label="Note (optional)"
        value={note}
        onChangeText={setNote}
        placeholder={NOTE_HINT[type] ?? 'Anything to remember about it'}
        maxLength={80}
        hint="Shown under its name in Accounts."
      />

      {existing && !existing.hidden ? (
        <View style={{ marginTop: space.lg }}>
          <ConfirmButton
            title="Delete account"
            confirmTitle="Tap again to delete it"
            onConfirm={() => {
              removeAccount(existing.id);
              navigation.goBack();
            }}
          />
          <Text style={[ui.hint, { textAlign: 'center' }]}>
            {inUse
              ? 'It has transactions, so it’s kept under Deleted accounts: past records keep its name, and you can bring it back.'
              : 'Nothing is recorded in it yet, so it goes for good.'}
          </Text>
        </View>
      ) : null}

      <CurrencyPicker
        visible={picker}
        title="Currency"
        options={CURRENCY_CODES}
        selected={code}
        onSelect={setCode}
        onClose={() => setPicker(false)}
      />
    </Screen>
  );
}

const st = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.lg },
  currencyRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  currencyName: { fontSize: 14, color: colors.textSoft },
  deleted: {
    marginBottom: space.lg,
    padding: space.md,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    gap: space.sm,
  },
  deletedText: { fontSize: 13, color: colors.textSoft, lineHeight: 19 },
});
