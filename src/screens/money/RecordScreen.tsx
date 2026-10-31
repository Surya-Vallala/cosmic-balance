// Record income, spending or a move between your own accounts (or edit one).
// New ones start on the amount keypad, then ask the category and account.

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { dayLabel, fromDay, toDay } from '../../dates';
import { currency, formatMoney, paiseToInput, parseRupees } from '../../money';
import type { ScreenProps } from '../../navigation';
import { evalAmount } from '../../pfm/amount';
import { categoryPath, convert, EVERY_LABEL, noteSuggestions, sortedAccounts } from '../../pfm/logic';
import { useMoney } from '../../pfm/store';
import type { MoneyRecord, RecordKind, Repeat, RepeatEvery } from '../../pfm/types';
import { AccountSheet, CategorySheet, Icon, Keypad, Sheet, SheetRow } from '../../pfm/ui';
import { uid } from '../../store';
import { colors, fonts, space } from '../../theme';
import type { Id } from '../../types';
import { Button, ConfirmButton, Empty, Screen, styles as ui } from '../../ui';

const KINDS: { id: RecordKind; label: string; color: string; soft: string }[] = [
  { id: 'income', label: 'Income', color: colors.owed, soft: colors.owedSoft },
  { id: 'expense', label: 'Expense', color: colors.owe, soft: colors.oweSoft },
  { id: 'transfer', label: 'Transfer', color: colors.star, soft: colors.starSoft },
];

const TITLES: Record<RecordKind, string> = { income: 'Income', expense: 'Expense', transfer: 'Transfer' };

export default function RecordScreen({ navigation, route }: ScreenProps<'Record'>) {
  const money = useMoney();
  const { m } = money;
  const insets = useSafeAreaInsets();
  const params = route.params ?? {};
  const existing = params.recordId ? m.records[params.recordId] : undefined;
  const source = existing ?? (params.copyOf ? m.records[params.copyOf] : undefined);
  const accounts = sortedAccounts(m);

  /** The account you used last for this kind of thing, else the first. */
  const lastAccount = (k: RecordKind): Id | null => {
    if (params.accountId && m.accounts[params.accountId]) return params.accountId;
    const recent = Object.values(m.records)
      .filter((r) => r.kind === k && m.accounts[r.accountId] && !m.accounts[r.accountId].hidden)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    return recent?.accountId ?? accounts[0]?.id ?? null;
  };

  const [kind, setKind] = useState<RecordKind>(source?.kind ?? params.kind ?? 'expense');
  const [day, setDay] = useState(existing ? toDay(existing.date) : toDay());
  const [expr, setExpr] = useState(source ? paiseToInput(source.amount) : '');
  const [categoryId, setCategoryId] = useState<Id | null>(source?.categoryId ?? null);
  const [accountId, setAccountId] = useState<Id | null>(source?.accountId ?? lastAccount(kind));
  const [toAccountId, setToAccountId] = useState<Id | null>(source?.toAccountId ?? null);
  const [arrived, setArrived] = useState(source?.toAmount !== undefined ? paiseToInput(source.toAmount) : '');
  const [note, setNote] = useState(source?.note ?? '');
  const [details, setDetails] = useState(source?.details ?? '');
  const [every, setEvery] = useState<RepeatEvery | null>(null);
  const [keypad, setKeypad] = useState(!existing && !source);
  const [sheet, setSheet] = useState<null | 'category' | 'account' | 'to' | 'repeat'>(null);
  const [error, setError] = useState<string | null>(null);
  const [noteFocus, setNoteFocus] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const flow = useRef(false); // new record: after the amount, ask category then account

  useLayoutEffect(() => {
    navigation.setOptions({ title: existing ? `Edit ${TITLES[kind].toLowerCase()}` : TITLES[kind] });
  }, [navigation, existing, kind]);

  // A record made by a repeat: say so.
  const repeat = existing?.repeatId ? m.repeats[existing.repeatId] : undefined;

  const acc = accountId ? m.accounts[accountId] : undefined;
  const toAcc = toAccountId ? m.accounts[toAccountId] : undefined;
  const code = acc?.currency ?? m.settings.currency;
  const amount = evalAmount(expr);
  const crossCurrency = kind === 'transfer' && !!acc && !!toAcc && acc.currency !== toAcc.currency;

  // Across currencies, suggest what arrives (until it's typed).
  const arrivedTyped = useRef(source?.toAmount !== undefined);
  useEffect(() => {
    if (!crossCurrency || arrivedTyped.current || !acc || !toAcc) return;
    setArrived(amount && amount > 0 ? paiseToInput(convert(m.settings, amount, acc.currency, toAcc.currency)) : '');
  }, [crossCurrency, amount, acc, toAcc, m.settings]);

  const suggestions = useMemo(
    () => (m.settings.suggestNotes && noteFocus && kind !== 'transfer' ? noteSuggestions(m, note, categoryId) : []),
    [m, note, categoryId, noteFocus, kind],
  );

  if (!accounts.length && !existing) {
    return (
      <Screen>
        <Empty
          title="Add an account first"
          body="Money needs to know where it comes from or goes to: cash, a bank account, a card…"
          action={<Button title="Add an account" onPress={() => navigation.replace('AccountForm', {})} />}
        />
      </Screen>
    );
  }

  const switchKind = (k: RecordKind) => {
    setError(null);
    if (k !== kind) {
      // A category belongs to income or spending.
      if (categoryId && m.categories[categoryId]?.kind !== k) setCategoryId(null);
      if (!existing && !source) setAccountId(lastAccount(k));
    }
    setKind(k);
  };

  const doneAmount = () => {
    if (/[+−-]/.test(expr.slice(1)) && amount !== null) {
      setExpr(paiseToInput(Math.max(0, amount)));
      return;
    }
    setKeypad(false);
    if (flow.current) return;
    flow.current = true;
    if (!existing && kind !== 'transfer' && !categoryId) setSheet('category');
    else if (!existing && kind === 'transfer' && !toAccountId) setSheet('to');
  };

  const check = (): MoneyRecord | null => {
    if (amount === null || amount <= 0) return fail('Enter an amount.');
    if (!accountId || !m.accounts[accountId]) return fail(kind === 'transfer' ? 'Pick the account it came from.' : 'Pick an account.');
    if (kind !== 'transfer' && !categoryId) return fail('Pick a category.');
    let toAmount: number | undefined;
    if (kind === 'transfer') {
      if (!toAccountId || !m.accounts[toAccountId]) return fail('Pick the account it went to.');
      if (toAccountId === accountId) return fail('Pick two different accounts.');
      if (crossCurrency) {
        const v = parseRupees(arrived);
        if (v === null || v <= 0) return fail(`Enter what arrived in ${m.accounts[toAccountId].name}.`);
        toAmount = v;
      }
    }
    const now = new Date().toISOString();
    return {
      id: existing?.id ?? uid(),
      kind,
      date: fromDay(day, existing?.date),
      amount,
      accountId,
      toAccountId: kind === 'transfer' ? toAccountId ?? undefined : undefined,
      toAmount,
      categoryId: kind === 'transfer' ? null : categoryId,
      note: note.trim() || undefined,
      details: details.trim() || undefined,
      repeatId: existing?.repeatId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
  };
  function fail(msg: string): null {
    setError(msg);
    return null;
  }

  const save = (again: boolean) => {
    const r = check();
    if (!r) return;
    if (every && !existing) {
      // Repeating: this is the first one; later ones are made on their day.
      const rep: Repeat = {
        id: uid(),
        every,
        start: day,
        lastMade: day,
        template: { kind: r.kind, amount: r.amount, accountId: r.accountId, toAccountId: r.toAccountId, toAmount: r.toAmount, categoryId: r.categoryId, note: r.note, details: r.details },
      };
      money.apply([
        { kind: 'repeat', id: rep.id, data: rep },
        { kind: 'record', id: `${rep.id}-${day}`, data: { ...r, id: `${rep.id}-${day}`, repeatId: rep.id } },
      ]);
    } else {
      money.saveRecord(r);
    }
    if (!again) {
      navigation.goBack();
      return;
    }
    // Continue: keep the day, kind and account; start the next one.
    setSaved(`Saved ${formatMoney(r.amount, code)}${r.note ? ` · ${r.note}` : ''}`);
    setExpr('');
    setNote('');
    setDetails('');
    setCategoryId(null);
    setEvery(null);
    setError(null);
    flow.current = false;
    setKeypad(true);
  };

  const kindInfo = KINDS.find((k) => k.id === kind)!;
  const catText = categoryId ? categoryPath(m.categories, categoryId).join(' › ') : 'Choose';
  const accText = (id: Id | null) => (id && m.accounts[id] ? m.accounts[id].name : 'Choose');

  return (
    <View style={{ flex: 1, backgroundColor: colors.space }}>
      <ScrollView contentContainerStyle={{ paddingBottom: space.xl }} keyboardShouldPersistTaps="handled">
        <View style={r.kinds} accessibilityRole="tablist" accessibilityLabel="Kind">
          {KINDS.map((k) => {
            const on = k.id === kind;
            return (
              <Pressable
                key={k.id}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                aria-selected={on}
                onPress={() => switchKind(k.id)}
                style={[r.kind, on && { borderColor: k.color, backgroundColor: k.soft, borderWidth: 1.5 }]}
              >
                <Text style={[r.kindText, on && { color: k.color, fontWeight: '700' }]}>{k.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {saved ? <Text style={r.saved}>{saved}. Next one:</Text> : null}

        <View style={r.form}>
          <Line label="Date">
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
              <DayPicker value={day} onChange={setDay} />
              {!existing ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={every ? `Repeats ${EVERY_LABEL[every].toLowerCase()}. Change` : 'Repeat'}
                  onPress={() => setSheet('repeat')}
                  style={r.repeat}
                >
                  <Icon name="repeat" size={18} color={every ? colors.star : colors.muted} />
                  <Text style={[r.repeatText, every && { color: colors.star }]}>{every ? EVERY_LABEL[every].replace('Every ', '') : 'Repeat'}</Text>
                </Pressable>
              ) : null}
            </View>
          </Line>
          <Line label="Amount" focused={keypad}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Amount: ${expr ? `${currency(code).symbol} ${expr}` : 'empty'}. Change`}
              onPress={() => setKeypad(true)}
              style={r.value}
            >
              <Text style={r.amount}>
                {currency(code).symbol} {expr || <Text style={{ color: colors.placeholder }}>0</Text>}
              </Text>
            </Pressable>
          </Line>
          {kind !== 'transfer' ? (
            <Line label="Category">
              <Pressable accessibilityRole="button" accessibilityLabel={`Category: ${catText}. Change`} onPress={() => setSheet('category')} style={r.value}>
                <Text style={[r.valueText, !categoryId && { color: colors.placeholder }]} numberOfLines={1}>
                  {catText}
                </Text>
              </Pressable>
            </Line>
          ) : null}
          <Line label={kind === 'transfer' ? 'From' : 'Account'}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${kind === 'transfer' ? 'From' : 'Account'}: ${accText(accountId)}. Change`} onPress={() => setSheet('account')} style={r.value}>
              <Text style={[r.valueText, !accountId && { color: colors.placeholder }]} numberOfLines={1}>
                {accText(accountId)}
              </Text>
            </Pressable>
          </Line>
          {kind === 'transfer' ? (
            <Line label="To">
              <Pressable accessibilityRole="button" accessibilityLabel={`To: ${accText(toAccountId)}. Change`} onPress={() => setSheet('to')} style={r.value}>
                <Text style={[r.valueText, !toAccountId && { color: colors.placeholder }]} numberOfLines={1}>
                  {accText(toAccountId)}
                </Text>
              </Pressable>
            </Line>
          ) : null}
          {crossCurrency && toAcc ? (
            <Line label="Arrived">
              <View style={[r.value, { flexDirection: 'row', alignItems: 'center' }]}>
                <Text style={r.valueText}>{currency(toAcc.currency).symbol} </Text>
                <TextInput
                  value={arrived}
                  onChangeText={(t) => {
                    arrivedTyped.current = true;
                    setArrived(t);
                  }}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={colors.placeholder}
                  accessibilityLabel={`What arrived in ${toAcc.name}`}
                  style={[r.input, { flex: 1 }]}
                />
              </View>
            </Line>
          ) : null}
          <Line label="Note">
            <TextInput
              value={note}
              onChangeText={setNote}
              onFocus={() => {
                setKeypad(false);
                setNoteFocus(true);
              }}
              onBlur={() => setTimeout(() => setNoteFocus(false), 150)}
              placeholder={kind === 'transfer' ? 'What it was for (optional)' : 'What it was (optional)'}
              placeholderTextColor={colors.placeholder}
              accessibilityLabel="Note"
              style={[r.input, { flex: 1 }]}
              maxLength={200}
              returnKeyType="done"
            />
          </Line>
          {suggestions.length ? (
            <View style={r.suggest} accessibilityLabel="Notes you used before">
              {suggestions.map((sug) => (
                <Pressable
                  key={sug}
                  accessibilityRole="button"
                  accessibilityLabel={`Use “${sug}”`}
                  onPress={() => {
                    setNote(sug);
                    setNoteFocus(false);
                  }}
                  style={({ pressed }) => [r.suggestRow, pressed && { backgroundColor: colors.raised }]}
                >
                  <Text style={r.suggestText} numberOfLines={1}>
                    {sug}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>

        <View style={r.lower}>
          <TextInput
            value={details}
            onChangeText={setDetails}
            onFocus={() => setKeypad(false)}
            placeholder="More details (optional)"
            placeholderTextColor={colors.placeholder}
            accessibilityLabel="More details"
            multiline
            style={r.details}
            maxLength={1000}
          />
          {repeat ? (
            <Text style={ui.hint}>
              Repeats {EVERY_LABEL[repeat.every].toLowerCase()}. Change or stop it under More › Repeating transactions.
            </Text>
          ) : every ? (
            <Text style={ui.hint}>
              This one is saved now, then again {EVERY_LABEL[every].toLowerCase()} from {dayLabel(day)} (Money adds each one on its day).
            </Text>
          ) : null}
          {error ? <Text style={[ui.hint, { color: colors.owe }]}>{error}</Text> : null}
          <View style={r.buttons}>
            <View style={{ flex: 2 }}>
              <Button title="Save" onPress={() => save(false)} />
            </View>
            {!existing ? (
              <View style={{ flex: 1 }}>
                <Button title="Continue" variant="secondary" onPress={() => save(true)} accessibilityLabel="Save and record another" />
              </View>
            ) : null}
          </View>
          {existing ? (
            <View style={{ gap: space.sm, marginTop: space.md }}>
              <Button title="Record it again" variant="secondary" onPress={() => navigation.replace('Record', { copyOf: existing.id })} />
              <ConfirmButton
                title={`Delete ${TITLES[kind].toLowerCase()}`}
                confirmTitle="Tap again to delete it"
                onConfirm={() => {
                  money.deleteRecord(existing.id);
                  navigation.goBack();
                }}
              />
            </View>
          ) : null}
        </View>
      </ScrollView>

      {keypad ? (
        <Keypad
          value={expr}
          onChange={(v) => {
            setError(null);
            setExpr(v);
          }}
          onDone={doneAmount}
          onClose={() => setKeypad(false)}
          currency={code}
        />
      ) : (
        <View style={{ height: insets.bottom }} />
      )}

      <CategorySheet
        visible={sheet === 'category'}
        kind={kind === 'income' ? 'income' : 'expense'}
        selected={categoryId}
        onPick={(id) => {
          setCategoryId(id);
          setError(null);
          // New record: then the account, if there's a choice to make.
          if (!existing && flow.current && accounts.length > 1 && !params.accountId) setTimeout(() => setSheet('account'), 250);
        }}
        onClose={() => setSheet((x) => (x === 'category' ? null : x))}
      />
      <AccountSheet
        visible={sheet === 'account'}
        title={kind === 'transfer' ? 'From' : kind === 'income' ? 'Into' : 'Paid from'}
        selected={accountId}
        onPick={(id) => {
          setAccountId(id);
          setError(null);
        }}
        onClose={() => setSheet((x) => (x === 'account' ? null : x))}
      />
      <AccountSheet
        visible={sheet === 'to'}
        title="To"
        selected={toAccountId}
        exclude={accountId ?? undefined}
        onPick={(id) => {
          setToAccountId(id);
          setError(null);
        }}
        onClose={() => setSheet((x) => (x === 'to' ? null : x))}
      />
      <Sheet visible={sheet === 'repeat'} onClose={() => setSheet(null)} title="Repeat">
        <SheetRow title="Don’t repeat" selected={!every} onPress={() => (setEvery(null), setSheet(null))} />
        {(Object.keys(EVERY_LABEL) as RepeatEvery[]).map((k) => (
          <SheetRow key={k} title={EVERY_LABEL[k]} selected={every === k} onPress={() => (setEvery(k), setSheet(null))} />
        ))}
        <Text style={[ui.hint, { marginHorizontal: space.lg }]}>Rent, an EMI, a subscription: Money adds it again on its day, until you stop it.</Text>
      </Sheet>
      {kindInfo ? null : null}
    </View>
  );
}

function Line({ label, children, focused }: { label: string; children: React.ReactNode; focused?: boolean }) {
  return (
    <View style={r.line}>
      <Text style={r.label}>{label}</Text>
      <View style={[r.lineValue, focused && { borderBottomColor: colors.star, borderBottomWidth: 2 }]}>{children}</View>
    </View>
  );
}

/** The day: tap to change (a calendar on the web, ‹ › elsewhere). */
function DayPicker({ value, onChange }: { value: string; onChange: (d: string) => void }) {
  const [y, mo, d] = value.split('-').map(Number);
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(y, mo - 1, d).getDay()];
  const text = `${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${String(y).slice(2)} (${wd})`;
  if (Platform.OS === 'web') {
    return (
      <View style={{ flex: 1, justifyContent: 'center', minHeight: 47 }}>
        <Text style={r.valueText}>{text}</Text>
        {React.createElement('input', {
          type: 'date',
          value,
          'aria-label': `Date: ${dayLabel(value)}. Change`,
          onChange: (e: { target: { value: string } }) => e.target.value && onChange(e.target.value),
          onClick: (e: { currentTarget: { showPicker?: () => void } }) => {
            try {
              e.currentTarget.showPicker?.();
            } catch {
              // the tap still focuses it
            }
          },
          style: { position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, border: 0, padding: 0, margin: 0, cursor: 'pointer', colorScheme: 'dark' },
        })}
      </View>
    );
  }
  const step = (n: number) => onChange(toDay(new Date(y, mo - 1, d + n)));
  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 47 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Day before" onPress={() => step(-1)} hitSlop={8}>
        <Text style={r.valueText}>‹</Text>
      </Pressable>
      <Text style={r.valueText}>{text}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Day after" onPress={() => step(1)} hitSlop={8}>
        <Text style={r.valueText}>›</Text>
      </Pressable>
    </View>
  );
}

const r = StyleSheet.create({
  kinds: { flexDirection: 'row', gap: 10, paddingHorizontal: space.lg, paddingTop: 6, paddingBottom: 10 },
  kind: { flex: 1, height: 40, borderRadius: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  kindText: { fontSize: 14, fontWeight: '600', color: colors.textSoft },
  saved: { marginHorizontal: space.lg, marginBottom: 4, fontSize: 12, color: colors.owed },
  form: { paddingHorizontal: space.lg },
  line: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
  label: { width: 84, fontSize: 14, color: colors.textSoft },
  lineValue: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.line },
  value: { flex: 1, minHeight: 47, justifyContent: 'center' },
  valueText: { fontSize: 15, color: colors.text },
  amount: { fontFamily: fonts.medium, fontSize: 17, color: colors.text },
  input: { minHeight: 47, padding: 0, fontSize: 15, color: colors.text, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : {}) },
  repeat: { paddingLeft: 8, height: 47, alignItems: 'center', justifyContent: 'center', gap: 1 },
  repeatText: { fontSize: 10, color: colors.muted },
  suggest: { marginLeft: 84, borderWidth: 1, borderColor: colors.line, borderRadius: 10, backgroundColor: colors.surface, overflow: 'hidden' },
  suggestRow: { paddingHorizontal: space.md, minHeight: 40, justifyContent: 'center' },
  suggestText: { fontSize: 14, color: colors.text },
  lower: { marginTop: space.md, borderTopWidth: 6, borderTopColor: colors.surface, paddingHorizontal: space.lg, paddingTop: space.sm },
  details: { minHeight: 46, paddingVertical: 12, fontSize: 15, color: colors.text, borderBottomWidth: 1, borderBottomColor: colors.line, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : {}) },
  buttons: { flexDirection: 'row', gap: 10, paddingTop: 14 },
});
