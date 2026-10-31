// The More tab: Money's settings, in one list. Everything here is private.
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { saveCsv } from '../../export';
import { approxRate, currency, CURRENCY_CODES, formatMoney, paiseToInput, parseNumber, parseRupees } from '../../money';
import type { ScreenProps } from '../../navigation';
import { buildMoneyCsv } from '../../pfm/export';
import { categoryPath, OUTSIDE } from '../../pfm/logic';
import { useMoney } from '../../pfm/store';
import type { MoneySettings, MoneyView } from '../../pfm/types';
import { goToTab, Sheet, SheetRow, TabBar, TabHeader, s as ms } from '../../pfm/ui';
import { useStore } from '../../store';
import { colors, fonts, space } from '../../theme';
import type { CurrencyCode } from '../../types';
import { Avatar, Button, ConfirmButton, CurrencyPicker, Empty, List, SectionTitle, SmallInput, styles as ui } from '../../ui';

const VIEWS: { value: MoneyView; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'calendar', label: 'Calendar' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'total', label: 'Total' },
];

/** 1st, 2nd, 3rd, 4th … 21st, 22nd, 28th */
export function ordinal(n: number): string {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`;
}

/** Rates are kept to 4 significant figures so they stay readable. */
const tidy = (r: number) => Number(r.toPrecision(4));

/**
 * The main currency changed: say every other rate against the new one, so
 * totals stay the same size (₹ per ฿ becomes $ per ฿).
 */
export function reexpressRates(s: MoneySettings, next: CurrencyCode): Record<CurrencyCode, number> {
  if (next === s.currency) return s.rates;
  const per = s.rates[next] ?? approxRate(next, s.currency); // old-main units per new-main unit
  const out: Record<CurrencyCode, number> = {};
  for (const [code, r] of Object.entries(s.rates)) {
    if (code === next) continue;
    out[code] = tidy(r / per);
  }
  out[s.currency] = tidy(1 / per);
  return out;
}

export default function MoreScreen({ navigation }: ScreenProps<'More'>) {
  const { state, mode } = useStore();
  const money = useMoney();
  const { m, setSettings, entries, unsaved, serverMissing } = money;
  const st = m.settings;
  const [sheet, setSheet] = useState<null | 'budget' | 'opens' | 'month' | 'week' | 'currency'>(null);
  const [budgetText, setBudgetText] = useState('');
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [rateText, setRateText] = useState<Record<string, string>>({});
  const me = state.meId ? state.people[state.meId] : undefined;
  const groupName = (id: string | null) => (id ? state.groups.find((g) => g.id === id)?.name ?? 'A group' : 'No group');

  // Currencies in play besides the main one: your accounts', your groups' and any rate you set.
  const others = useMemo(() => {
    const set = new Set<CurrencyCode>();
    for (const a of Object.values(m.accounts)) if (!a.hidden) set.add(a.currency);
    for (const g of state.groups) {
      set.add(g.baseCurrency);
      Object.keys(g.rates ?? {}).forEach((c) => set.add(c));
    }
    Object.keys(st.rates).forEach((c) => set.add(c));
    set.delete(st.currency);
    return [...set].sort();
  }, [m.accounts, state.groups, st.rates, st.currency]);

  if (!st.enabled) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.space }}>
        <TabHeader>
          {navigation.canGoBack() ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => navigation.goBack()} style={ms.headerButton}>
              <Text style={{ color: colors.text, fontSize: 24 }}>‹</Text>
            </Pressable>
          ) : null}
          <Text style={ms.headerTitle}>More</Text>
        </TabHeader>
        <ScrollView contentContainerStyle={{ padding: space.lg }}>
          <Empty
            title="Money is off"
            body="Keep track of your own accounts, income and spending, next to your splits. Only you see it."
            action={<Button title="Turn on Money" onPress={() => navigation.navigate('MoneySetup', { step: 1 })} />}
          />
        </ScrollView>
      </View>
    );
  }

  // ---- Values shown on the right of each row -------------------------------------
  const groupKeys = new Set([...state.groups.map((g) => g.id), OUTSIDE]);
  const usualCount = Object.entries(st.usual).filter(([k, v]) => groupKeys.has(k) && v !== undefined).length;
  const keyName = (k: string) => (k === OUTSIDE ? 'No group' : groupName(k));
  const shareCats = Object.entries(st.groupCategory).filter(([k, c]) => groupKeys.has(k) && m.categories[c]);
  const shareValue = shareCats.length
    ? `${keyName(shareCats[0][0])}: ${categoryPath(m.categories, shareCats[0][1]).join(' › ')}${shareCats.length > 1 ? '…' : ''}`
    : 'Not set';
  const repeats = Object.values(m.repeats);
  const repeatNames = repeats.map((r) => r.template.note?.trim() || (r.template.kind === 'transfer' ? 'Transfer' : categoryPath(m.categories, r.template.categoryId).slice(-1)[0]));
  const repeatValue = !repeats.length ? 'None' : repeatNames.length <= 2 ? repeatNames.join(', ') : `${repeatNames.slice(0, 2).join(', ')}, ${repeatNames.length - 2} more`;

  const saveRate = (code: CurrencyCode) => {
    const raw = rateText[code];
    if (raw === undefined) return;
    const v = parseNumber(raw);
    if (v !== null && v > 0) setSettings({ rates: { ...st.rates, [code]: v } });
    setRateText(({ [code]: _gone, ...rest }) => rest);
  };

  const status = serverMissing
    ? 'Saved on this phone only until your Cosmic Balance database is updated.'
    : unsaved > 0
      ? `${unsaved} change${unsaved === 1 ? '' : 's'} waiting to be sent`
      : mode === 'cloud'
        ? 'Saved to your account. Only you can see it.'
        : 'Saved on this phone.';

  const openBudget = () => {
    setBudgetText(st.budget ? paiseToInput(st.budget) : '');
    setBudgetError(null);
    setSheet('budget');
  };
  const saveBudget = () => {
    const v = parseRupees(budgetText);
    if (v === null || v <= 0) return setBudgetError('Enter an amount, like 70000.');
    setSettings({ budget: v });
    setSheet(null);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.space }}>
      <TabHeader>
        <Text style={ms.headerTitle} accessibilityRole="header">
          More
        </Text>
      </TabHeader>
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxl }} keyboardShouldPersistTaps="handled">
        <List style={{ marginTop: space.sm }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Your profile, picture and UPI ID"
            onPress={() => state.meId && navigation.navigate('FriendForm', { personId: state.meId })}
            style={({ pressed }) => [st2.profile, pressed && { backgroundColor: colors.raised }]}
          >
            <Avatar id={state.meId ?? undefined} name={me?.name ?? '?'} size={44} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={st2.profileName} numberOfLines={1}>
                {me?.name ?? 'You'}
              </Text>
              <Text style={st2.profileSub} numberOfLines={1}>
                Profile, picture and UPI ID
              </Text>
            </View>
            <Chevron />
          </Pressable>
        </List>

        <SectionTitle>Accounts</SectionTitle>
        <List>
          <SettingRow label="Accounts" onPress={() => goToTab(navigation as unknown as Parameters<typeof goToTab>[0], 'More', 'Accounts')} />
          <SettingRow label="Usual account for each group" value={usualCount ? `${usualCount} set` : 'Not set'} onPress={() => navigation.navigate('GroupMoney')} last />
        </List>

        <SectionTitle>Categories and repeats</SectionTitle>
        <List>
          <SettingRow label="Expense categories" onPress={() => navigation.navigate('Categories', { kind: 'expense' })} />
          <SettingRow label="Income categories" onPress={() => navigation.navigate('Categories', { kind: 'income' })} />
          <SettingRow label="Sub-categories" hint="Car › Fuel, Home › Rent" toggle={st.subcategories} onToggle={(v) => setSettings({ subcategories: v })} />
          <SettingRow label="Category for each group’s shares" value={shareValue} onPress={() => navigation.navigate('GroupMoney')} />
          <SettingRow
            label="Monthly budget"
            value={st.budget ? `${formatMoney(st.budget, st.currency)} a month` : 'Off'}
            onPress={openBudget}
          />
          <SettingRow label="Repeating transactions" value={repeatValue} onPress={() => navigation.navigate('Repeats')} last />
        </List>

        <SectionTitle>How Money looks</SectionTitle>
        <List>
          <SettingRow label="Main currency" value={`${st.currency} (${currency(st.currency).symbol})`} onPress={() => setSheet('currency')} />
          {others.length ? (
            <View style={[st2.rates, ui.rowDivider]}>
              <Text style={st2.label}>Other currencies and rates</Text>
              {others.map((code) => {
                const saved = st.rates[code];
                return (
                  <View key={code} style={st2.rateRow}>
                    <Text style={st2.rateText}>1 {code} =</Text>
                    <Text style={st2.rateText}>{currency(st.currency).symbol}</Text>
                    <SmallInput
                      value={rateText[code] ?? (saved !== undefined ? String(saved) : '')}
                      placeholder={String(approxRate(code, st.currency))}
                      onChangeText={(t) => setRateText((r) => ({ ...r, [code]: t }))}
                      onBlur={() => saveRate(code)}
                      onSubmitEditing={() => saveRate(code)}
                      accessibilityLabel={`${currency(st.currency).name} for one ${currency(code).name}`}
                      style={{ width: 110 }}
                    />
                  </View>
                );
              })}
              <Text style={ui.hint}>
                Only used to add up totals in {st.currency}. A group’s own rate is used for its expenses when the group uses {st.currency} too.
              </Text>
            </View>
          ) : null}
          <SettingRow label="Opens on" value={VIEWS.find((v) => v.value === st.opensOn)?.label} onPress={() => setSheet('opens')} />
          <SettingRow label="Month starts on" value={`The ${ordinal(st.monthStart)}`} onPress={() => setSheet('month')} />
          <SettingRow label="Week starts on" value={st.weekStart === 0 ? 'Sunday' : 'Monday'} onPress={() => setSheet('week')} />
          <SettingRow label="Time on transactions" toggle={st.showTime} onToggle={(v) => setSettings({ showTime: v })} />
          <SettingRow label="Show more details in the list" toggle={st.showDetails} onToggle={(v) => setSettings({ showDetails: v })} />
          <SettingRow label="Suggest notes as you type" toggle={st.suggestNotes} onToggle={(v) => setSettings({ suggestNotes: v })} last />
        </List>

        <SectionTitle>Privacy and data</SectionTitle>
        <List>
          <SettingRow
            label="Export Money to Excel (CSV)"
            onPress={async () => {
              setExportNote(null);
              try {
                const csv = buildMoneyCsv(m, entries, groupName);
                setExportNote(await saveCsv(csv, `cosmic-balance-money-${new Date().toISOString().slice(0, 10)}.csv`));
              } catch {
                setExportNote('Couldn’t save the file. Try again.');
              }
            }}
            last
          />
        </List>
        {exportNote ? <Text style={st2.note}>{exportNote}</Text> : null}
        <Text style={st2.note} accessibilityRole="text">
          {status}
        </Text>

        <SectionTitle>Cosmic Balance</SectionTitle>
        <List>
          {mode === 'cloud' ? <SettingRow label="Notifications" onPress={() => navigation.navigate('Notifications')} /> : null}
          <SettingRow label="What’s new" onPress={() => navigation.navigate('MoneySetup', { step: 1 })} />
          <SettingRow label="About" onPress={() => navigation.navigate('About')} last />
        </List>

        <SectionTitle>Money</SectionTitle>
        <ConfirmButton
          title="Turn Money off"
          confirmTitle="Tap again to turn Money off"
          onConfirm={() => {
            setSettings({ enabled: false });
            navigation.popToTop();
          }}
        />
        <Text style={st2.note}>Money and the bottom bar go away. Nothing is deleted: turn it back on from your profile.</Text>
      </ScrollView>
      <TabBar current="More" />

      <CurrencyPicker
        visible={sheet === 'currency'}
        title="Main currency"
        options={CURRENCY_CODES}
        selected={st.currency}
        onSelect={(code) => {
          if (code !== st.currency) setSettings({ currency: code, rates: reexpressRates(st, code) });
          setRateText({});
        }}
        onClose={() => setSheet(null)}
      />

      <Sheet visible={sheet === 'opens'} onClose={() => setSheet(null)} title="Money opens on">
        {VIEWS.map((v) => (
          <SheetRow
            key={v.value}
            title={v.label}
            selected={st.opensOn === v.value}
            onPress={() => {
              setSettings({ opensOn: v.value });
              setSheet(null);
            }}
          />
        ))}
      </Sheet>

      <Sheet visible={sheet === 'week'} onClose={() => setSheet(null)} title="Week starts on">
        {(
          [
            [1, 'Monday'],
            [0, 'Sunday'],
          ] as const
        ).map(([v, label]) => (
          <SheetRow
            key={v}
            title={label}
            selected={st.weekStart === v}
            onPress={() => {
              setSettings({ weekStart: v });
              setSheet(null);
            }}
          />
        ))}
      </Sheet>

      <Sheet visible={sheet === 'month'} onClose={() => setSheet(null)} title="Month starts on">
        <Text style={[ui.hint, { marginTop: 0, marginHorizontal: space.lg, marginBottom: space.sm }]}>
          For people paid on the 25th: each month runs from that day to the day before it next month.
        </Text>
        <ScrollView style={{ maxHeight: 380 }}>
          {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
            <SheetRow
              key={d}
              title={`The ${ordinal(d)}`}
              selected={st.monthStart === d}
              onPress={() => {
                setSettings({ monthStart: d });
                setSheet(null);
              }}
            />
          ))}
        </ScrollView>
      </Sheet>

      <Sheet visible={sheet === 'budget'} onClose={() => setSheet(null)} title="Monthly budget">
        <View style={{ paddingHorizontal: space.lg }}>
          <Text style={[ui.hint, { marginTop: 0, marginBottom: space.md }]}>
            How much you plan to spend in a month, in {st.currency}. Your shares in groups count too. Stats shows how much is left.
          </Text>
          <View style={st2.budgetBox}>
            <Text style={st2.budgetSymbol}>{currency(st.currency).symbol}</Text>
            <TextInput
              value={budgetText}
              onChangeText={(t) => {
                setBudgetText(t);
                setBudgetError(null);
              }}
              placeholder="70000"
              placeholderTextColor={colors.placeholder}
              keyboardType="decimal-pad"
              keyboardAppearance="dark"
              selectionColor={colors.star}
              accessibilityLabel="Monthly budget"
              onSubmitEditing={saveBudget}
              style={st2.budgetInput}
            />
          </View>
          {budgetError ? <Text style={ui.error}>{budgetError}</Text> : null}
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.lg }}>
            {st.budget ? (
              <View style={{ flex: 1 }}>
                <Button
                  title="Turn off"
                  variant="secondary"
                  onPress={() => {
                    setSettings({ budget: null });
                    setSheet(null);
                  }}
                />
              </View>
            ) : null}
            <View style={{ flex: 2 }}>
              <Button title="Save" onPress={saveBudget} />
            </View>
          </View>
        </View>
      </Sheet>
    </View>
  );
}

function Chevron() {
  return <Text style={st2.chevron}>›</Text>;
}

/** A settings row: label on the left; its value, a switch or › on the right. */
function SettingRow({
  label,
  value,
  hint,
  onPress,
  toggle,
  onToggle,
  last,
}: {
  label: string;
  value?: string;
  hint?: string;
  onPress?: () => void;
  toggle?: boolean;
  onToggle?: (v: boolean) => void;
  last?: boolean;
}) {
  const body = (
    <View style={[st2.row, !last && ui.rowDivider]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={st2.label}>{label}</Text>
        {hint ? <Text style={st2.hint}>{hint}</Text> : null}
      </View>
      {value ? (
        <Text style={st2.value} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {onToggle ? (
        <Switch
          value={!!toggle}
          onValueChange={onToggle}
          accessibilityLabel={label}
          trackColor={{ true: colors.star, false: colors.line }}
          thumbColor={colors.text}
          // react-native-web uses its own prop names for the "on" colours
          {...({ activeThumbColor: colors.text, activeTrackColor: colors.star } as object)}
        />
      ) : onPress ? (
        <Chevron />
      ) : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}: ${value}` : label}
      onPress={onPress}
      style={({ pressed }) => pressed && { backgroundColor: colors.raised }}
    >
      {body}
    </Pressable>
  );
}

const st2 = StyleSheet.create({
  profileSub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg },
  profileName: { fontFamily: fonts.medium, fontSize: 16, color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 50, paddingVertical: 8, paddingHorizontal: space.lg },
  label: { fontSize: 15, color: colors.text },
  hint: { fontSize: 12, color: colors.muted, marginTop: 2 },
  value: { fontSize: 13, color: colors.muted, maxWidth: '55%', textAlign: 'right' },
  chevron: { fontSize: 20, color: colors.muted, marginLeft: 2, lineHeight: 22 },
  note: { fontSize: 12, color: colors.muted, marginTop: space.sm, marginHorizontal: space.xs, lineHeight: 17 },
  rates: { paddingVertical: space.md, paddingHorizontal: space.lg, gap: space.sm },
  rateRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rateText: { fontSize: 14, color: colors.textSoft },
  budgetBox: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderColor: colors.line, borderRadius: 14, backgroundColor: colors.raised, paddingHorizontal: space.md },
  budgetSymbol: { fontFamily: fonts.medium, fontSize: 20, color: colors.textSoft },
  budgetInput: { flex: 1, minWidth: 0, height: 52, fontFamily: fonts.light, fontSize: 26, color: colors.text },
});
