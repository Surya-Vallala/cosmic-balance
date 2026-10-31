// Turning Money on: what's new in three short steps, then the accounts you use.
// Nothing changes until Finish (or Set up later); Not now leaves the app as it was.

import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { currency as currencyInfo, parseRupees } from '../../money';
import type { ScreenProps } from '../../navigation';
import { Icon, PrivateLine } from '../../pfm/ui';
import { useMoney } from '../../pfm/store';
import { ACCOUNT_TYPES, type Account, type AccountType } from '../../pfm/types';
import { uid, useStore } from '../../store';
import { colors, fonts, radius, space } from '../../theme';
import { Button, Chip, Starfield, styles as ui } from '../../ui';

/** The types offered at setup, with a starting name and an example for the name box. */
const SETUP: { type: AccountType; name: string; example: string }[] = [
  { type: 'cash', name: 'Cash', example: 'Cash' },
  { type: 'bank', name: 'Bank account', example: 'HDFC Savings' },
  { type: 'card', name: 'Credit card', example: 'Amazon ICICI' },
  { type: 'wallet', name: 'Wallet', example: 'Paytm wallet' },
  { type: 'travel', name: 'Forex card', example: 'Forex card' },
  { type: 'investment', name: 'Investments', example: 'Fixed deposit' },
  { type: 'lent', name: 'Money lent', example: 'Hand loan' },
  { type: 'loan', name: 'Loan', example: 'Car loan' },
];

const typeInfo = (t: AccountType) => ACCOUNT_TYPES.find((x) => x.id === t)!;

/** The main currency to start with: the one your groups use most. */
function likelyCurrency(groups: { baseCurrency: string }[]): string {
  const count: Record<string, number> = {};
  for (const g of groups) count[g.baseCurrency] = (count[g.baseCurrency] ?? 0) + 1;
  return Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'INR';
}

interface Pick {
  name: string;
  balance: string;
}

export default function MoneySetupScreen({ navigation, route }: ScreenProps<'MoneySetup'>) {
  const insets = useSafeAreaInsets();
  const { state } = useStore();
  const money = useMoney();
  const start = Math.min(3, Math.max(1, Math.round(Number(route.params?.step ?? 1)) || 1));
  const [step, setStepState] = useState(start);
  const [picked, setPicked] = useState<Partial<Record<AccountType, Pick>>>({ cash: { name: 'Cash', balance: '' } });
  const [categories, setCategories] = useState(true);
  const [touched, setTouched] = useState(false);

  const main = money.m.settings.startedOn ? money.m.settings.currency : likelyCurrency(state.groups);
  const symbol = currencyInfo(main).symbol;

  const setStep = (n: number) => {
    setStepState(n);
    navigation.setParams({ step: n });
  };
  const close = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
  };

  const toggle = (t: AccountType) =>
    setPicked((p) => {
      const next = { ...p };
      if (next[t]) delete next[t];
      else next[t] = { name: SETUP.find((x) => x.type === t)?.name ?? typeInfo(t).one, balance: '' };
      return next;
    });
  const edit = (t: AccountType, patch: Partial<Pick>) => setPicked((p) => ({ ...p, [t]: { ...(p[t] as Pick), ...patch } }));

  const rows = SETUP.filter((x) => picked[x.type]);
  const balanceError = (t: AccountType): string | null => {
    const v = picked[t]?.balance.trim() ?? '';
    if (!v) return null;
    return parseRupees(v) === null ? 'Enter an amount like 2500 or 2500.50.' : null;
  };
  const nameMissing = (t: AccountType) => !picked[t]?.name.trim();
  const invalid = rows.some((r) => balanceError(r.type) || nameMissing(r.type));

  const goToMoney = () => navigation.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'Money' }] });

  const finish = () => {
    setTouched(true);
    if (invalid) return;
    const now = new Date().toISOString();
    const already = Object.keys(money.m.accounts).length;
    const accounts: Account[] = rows.map((r, i) => {
      const p = picked[r.type] as Pick;
      const value = parseRupees(p.balance.trim()) ?? 0;
      return {
        id: uid(),
        name: p.name.trim().slice(0, 60),
        type: r.type,
        currency: main,
        opening: typeInfo(r.type).owed ? -value : value,
        order: already + i,
        createdAt: now,
      };
    });
    money.turnOn({ accounts, categories, currency: main });
    goToMoney();
  };

  const later = () => {
    money.turnOn({ categories: true, currency: main });
    goToMoney();
  };

  const lead = (
    <View style={s.leadRow}>
      <Text style={s.lead}>STEP {step} OF 3</Text>
      <View style={s.dots} aria-hidden>
        {[1, 2, 3].map((n) => (
          <View key={n} style={[s.dot, n === step && s.dotOn]} />
        ))}
      </View>
      {step < 3 ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Not now" onPress={close} hitSlop={8}>
          <Text style={s.notNow}>Not now</Text>
        </Pressable>
      ) : null}
    </View>
  );

  let body: React.ReactNode;
  let footer: React.ReactNode;
  if (step === 1) {
    body = (
      <>
        <Text style={s.title} accessibilityRole="header">
          Three new tabs, just for you
        </Text>
        <View style={s.points}>
          <Point name="Money" text="your income and spending, day by day" />
          <Point name="Stats" text="where it went, by category" />
          <Point name="Accounts" text="your bank, cards, cash and more" />
          <Point name="More" text="settings for Money" />
        </View>
        <Text style={s.body}>Split is everything you have today, unchanged.</Text>
        <View role="img" aria-label="The bottom bar: Split, Money, Stats, Accounts and More" style={s.barMock}>
          <View aria-hidden style={{ flexDirection: 'row' }} pointerEvents="none">
            {(
              [
                ['split', 'Split'],
                ['money', 'Money'],
                ['stats', 'Stats'],
                ['accounts', 'Accounts'],
                ['more', 'More'],
              ] as const
            ).map(([icon, label]) => {
              const isNew = label !== 'Split';
              return (
                <View key={label} style={s.barItem}>
                  <Icon name={icon} color={isNew ? colors.star : colors.muted} />
                  <Text style={[s.barText, isNew && { color: colors.star, fontWeight: '700' }]}>{label}</Text>
                </View>
              );
            })}
          </View>
        </View>
      </>
    );
    footer = (
      <View style={s.footerRow}>
        <Button title="Skip" variant="secondary" onPress={() => setStep(3)} accessibilityLabel="Skip to setting up accounts" style={{ flex: 1 }} />
        <Button title="Next" onPress={() => setStep(2)} style={{ flex: 2 }} />
      </View>
    );
  } else if (step === 2) {
    body = (
      <>
        <Text style={s.title} accessibilityRole="header">
          When you pay for a group
        </Text>
        <Text style={s.body}>
          Expense forms get one new line: which of your accounts paid. Only you see it; your friends see the expense as they always have.
        </Text>
        <View role="img" aria-label="Example: Paid from HDFC Savings, only you see this" style={s.formMock}>
          <View aria-hidden pointerEvents="none">
            <Text style={ui.label}>What was it for?</Text>
            <View style={s.fakeInput}>
              <Text style={s.fakeText}>Hostel, 3 nights</Text>
            </View>
            <Text style={ui.label}>Paid by</Text>
            <View style={[s.fakeInput, { marginBottom: space.lg }]}>
              <Text style={s.fakeText}>You</Text>
            </View>
            <PrivateLine label="Paid from" value="HDFC Savings" onPress={() => {}} />
          </View>
        </View>
        <Text style={s.body}>
          It remembers your choice for each group, and settle-ups ask “Received into” the same way. It only appears once you’ve added an account.
        </Text>
      </>
    );
    footer = (
      <View style={s.footerRow}>
        <Button title="Back" variant="secondary" onPress={() => setStep(1)} style={{ flex: 1 }} />
        <Button title="Next" onPress={() => setStep(3)} style={{ flex: 2 }} />
      </View>
    );
  } else {
    body = (
      <>
        <Text style={s.title} accessibilityRole="header">
          Which accounts do you use?
        </Text>
        <Text style={s.body}>Tap the ones you have. You can add more, rename them or change balances any time.</Text>
        <View style={s.chips} role="group" aria-label="Account types">
          {SETUP.map((x) => (
            <Chip key={x.type} label={typeInfo(x.type).one} selected={!!picked[x.type]} onPress={() => toggle(x.type)} />
          ))}
        </View>
        {rows.length ? (
          <View style={s.card}>
            {rows.map((r, i) => {
              const p = picked[r.type] as Pick;
              const owed = !!typeInfo(r.type).owed;
              const one = typeInfo(r.type).one;
              const err = touched ? balanceError(r.type) : null;
              const noName = touched && nameMissing(r.type);
              return (
                <View key={r.type} style={[s.accRow, i < rows.length - 1 && s.accDivider]}>
                  <View style={s.accLine}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.accType}>{owed ? `${one} · amount owed` : one}</Text>
                      <TextInput
                        value={p.name}
                        onChangeText={(v) => edit(r.type, { name: v })}
                        placeholder={r.example}
                        placeholderTextColor={colors.placeholder}
                        accessibilityLabel={`${one} name`}
                        style={s.nameInput}
                        maxLength={60}
                        selectionColor={colors.star}
                        keyboardAppearance="dark"
                      />
                    </View>
                    <View style={[s.balanceBox, err ? { borderColor: colors.owe } : null]}>
                      <Text style={s.symbol}>{symbol}</Text>
                      <TextInput
                        value={p.balance}
                        onChangeText={(v) => edit(r.type, { balance: v })}
                        placeholder="0"
                        placeholderTextColor={colors.placeholder}
                        keyboardType="decimal-pad"
                        inputMode="decimal"
                        accessibilityLabel={owed ? `${one} amount owed` : `${one} balance now`}
                        style={s.balanceInput}
                        selectionColor={colors.star}
                        keyboardAppearance="dark"
                      />
                    </View>
                  </View>
                  {noName ? <Text style={ui.error}>Give it a name.</Text> : null}
                  {err ? <Text style={ui.error}>{err}</Text> : null}
                </View>
              );
            })}
          </View>
        ) : (
          <Text style={[ui.hint, { marginTop: 0 }]}>No accounts? That’s fine: you can still record income and spending, and add accounts later.</Text>
        )}
        <Text style={[ui.hint, { marginTop: -space.sm }]}>
          {`Balances are in ${currencyInfo(main).name} (${main}). An account in another currency, like a forex card, can be changed under Accounts.`}
        </Text>
        <View style={s.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.switchTitle}>Start with common categories</Text>
            <Text style={s.switchSub}>Food, Car › Fuel, Home › Maintenance, Travel, Bills… edit any time</Text>
          </View>
          <Switch
            value={categories}
            onValueChange={setCategories}
            accessibilityLabel="Start with common categories"
            trackColor={{ true: colors.star, false: colors.line }}
            thumbColor={colors.text}
            // react-native-web uses its own prop names for the "on" colours
            {...({ activeThumbColor: colors.text, activeTrackColor: colors.star } as object)}
          />
        </View>
      </>
    );
    footer = (
      <View style={{ gap: 4 }}>
        <Button title="Finish" onPress={finish} disabled={touched && invalid} />
        <Button title="Set up later" variant="ghost" onPress={later} accessibilityLabel="Set up accounts later" />
      </View>
    );
  }

  return (
    <View style={s.screen}>
      <View style={[s.sky, { height: insets.top + 120 }]} pointerEvents="none">
        <Starfield count={22} seed={11} />
      </View>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + space.lg, paddingHorizontal: space.lg, paddingBottom: space.xl, gap: space.lg }}
        keyboardShouldPersistTaps="handled"
      >
        {lead}
        {body}
      </ScrollView>
      <View style={[s.footer, { paddingBottom: space.md + insets.bottom }]}>{footer}</View>
    </View>
  );
}

function Point({ name, text }: { name: string; text: string }) {
  return (
    <Text style={s.point}>
      <Text style={{ fontWeight: '700', color: colors.text }}>{name}</Text> · {text}
    </Text>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.space },
  sky: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
  leadRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 32 },
  lead: { flex: 1, fontSize: 12, fontWeight: '700', color: colors.star, letterSpacing: 0.4 },
  dots: { flexDirection: 'row', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.line },
  dotOn: { width: 18, backgroundColor: colors.star },
  notNow: { fontSize: 14, fontWeight: '600', color: colors.textSoft, paddingVertical: 6 },
  title: { fontFamily: fonts.medium, fontSize: 21, lineHeight: 28, color: colors.text },
  body: { fontSize: 14, lineHeight: 20, color: colors.textSoft },
  points: { gap: space.sm },
  point: { fontSize: 15, lineHeight: 22, color: colors.textSoft },
  barMock: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.space, paddingVertical: space.sm },
  barItem: { flex: 1, alignItems: 'center', gap: 3 },
  barText: { fontSize: 11, fontWeight: '500', color: colors.muted },
  formMock: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, padding: space.lg, paddingBottom: 0 },
  fakeInput: { height: 46, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.raised, justifyContent: 'center', paddingHorizontal: space.md, marginBottom: space.md },
  fakeText: { fontSize: 15, color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  card: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: 'hidden' },
  accRow: { paddingVertical: 10, paddingHorizontal: 14 },
  accDivider: { borderBottomWidth: 1, borderBottomColor: colors.line },
  accLine: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  accType: { fontSize: 11, color: colors.muted },
  nameInput: { height: 30, padding: 0, fontSize: 15, color: colors.text },
  balanceBox: { width: 124, height: 40, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.raised },
  symbol: { fontSize: 14, color: colors.muted },
  balanceInput: { flex: 1, minWidth: 0, height: 38, padding: 0, fontSize: 15, color: colors.text, textAlign: 'right' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  switchTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  switchSub: { fontSize: 12, lineHeight: 16, color: colors.muted, marginTop: 2 },
  footer: { paddingTop: 10, paddingHorizontal: space.lg, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.space },
  footerRow: { flexDirection: 'row', gap: space.sm },
});
