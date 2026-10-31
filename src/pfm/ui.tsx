// Pieces Money's screens share: the bottom bar, month switcher, totals,
// day headers, list rows, the account and category pickers, and the keypad.

import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { formatMoney } from '../money';
import type { RootStackParamList } from '../navigation';
import { uid } from '../store';
import { colors, fonts, space } from '../theme';
import type { CurrencyCode, Id } from '../types';
import { styles as ui } from '../ui';
import { hasSum, pressKey } from './amount';
import { categoryPath, monthName, shortMonth, sortedAccounts, SPLIT_CATEGORY, subCategories, topCategories, weekday, type Entry } from './logic';
import { useMoney } from './store';
import { ACCOUNT_TYPES, type Account, type Category, type CategoryKind, type MoneyData } from './types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// ---------------------------------------------------------------------------
// Icons

export function Icon({ name, size = 22, color = colors.text }: { name: IconName; size?: number; color?: string }) {
  const p = { fill: 'none', stroke: color, strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'split' ? (
        <>
          <Circle cx="12" cy="12" r="7.5" {...p} />
          <Circle cx="18" cy="6.5" r="2" fill={color} stroke={color} />
        </>
      ) : name === 'money' ? (
        <>
          <Rect x="5" y="3" width="14" height="18" rx="2" {...p} />
          <Path d="M9 8h6M9 12h6M9 16h4" {...p} />
        </>
      ) : name === 'stats' ? (
        <Path d="M6 19v-7M12 19V5M18 19v-4M3 21h18" {...p} />
      ) : name === 'accounts' ? (
        <>
          <Path d="M3 7a2 2 0 0 1 2-2h12v4" {...p} />
          <Path d="M3 7v10a2 2 0 0 0 2 2h14V9H5a2 2 0 0 1-2-2z" {...p} />
          <Circle cx="16" cy="14" r="1.2" {...p} />
        </>
      ) : name === 'more' ? (
        <>
          <Circle cx="5" cy="12" r="2" fill={color} />
          <Circle cx="12" cy="12" r="2" fill={color} />
          <Circle cx="19" cy="12" r="2" fill={color} />
        </>
      ) : name === 'search' ? (
        <>
          <Circle cx="11" cy="11" r="6.5" {...p} />
          <Path d="M16 16l4.5 4.5" {...p} />
        </>
      ) : name === 'filter' ? (
        <>
          <Path d="M4 7h10M18 7h2M4 17h4M12 17h8" {...p} />
          <Circle cx="16" cy="7" r="2" {...p} />
          <Circle cx="10" cy="17" r="2" {...p} />
        </>
      ) : name === 'lock' ? (
        <>
          <Rect x="5" y="11" width="14" height="9" rx="2" {...p} strokeWidth={2.2} />
          <Path d="M8 11V8a4 4 0 0 1 8 0v3" {...p} strokeWidth={2.2} />
        </>
      ) : name === 'plus' ? (
        <Path d="M12 5v14M5 12h14" {...p} strokeWidth={2.4} />
      ) : name === 'repeat' ? (
        <Path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4" {...p} />
      ) : name === 'edit' ? (
        <>
          <Path d="M4 20h4L19 9l-4-4L4 16z" {...p} />
          <Path d="M13.5 6.5l4 4" {...p} />
        </>
      ) : name === 'check' ? (
        <Path d="M5 12l5 5 9-10" {...p} strokeWidth={2.2} />
      ) : (
        <Path d="M7 17L17 7M9 7h8v8" {...p} />
      )}
    </Svg>
  );
}
type IconName = 'split' | 'money' | 'stats' | 'accounts' | 'more' | 'search' | 'filter' | 'lock' | 'plus' | 'repeat' | 'edit' | 'check' | 'arrow';

// ---------------------------------------------------------------------------
// The bottom bar (only when Money is on)

export type Tab = 'Home' | 'Money' | 'Stats' | 'Accounts' | 'More';
const TABS: { name: Tab; label: string; icon: IconName }[] = [
  { name: 'Home', label: 'Split', icon: 'split' },
  { name: 'Money', label: 'Money', icon: 'money' },
  { name: 'Stats', label: 'Stats', icon: 'stats' },
  { name: 'Accounts', label: 'Accounts', icon: 'accounts' },
  { name: 'More', label: 'More', icon: 'more' },
];

/** Switch tabs: Split is always underneath, the others replace each other on top of it. */
export function goToTab(navigation: unknown, from: Tab, to: Tab) {
  if (to === from) return;
  const go = navigation as { navigate: (n: string) => void; replace: (n: string) => void; popToTop: () => void };
  if (to === 'Home') go.popToTop();
  else if (from === 'Home') go.navigate(to);
  else go.replace(to);
}

export function TabBar({ current }: { current: Tab }) {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  return (
    <View accessibilityRole="tablist" style={[s.tabBar, { paddingBottom: insets.bottom }]}>
      {TABS.map((t) => {
        const on = t.name === current;
        return (
          <Pressable
            key={t.name}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            aria-selected={on}
            accessibilityLabel={t.label}
            onPress={() => goToTab(navigation, current, t.name)}
            style={s.tab}
          >
            <Icon name={t.icon} color={on ? colors.star : colors.muted} />
            <Text style={[s.tabText, on && s.tabTextOn]}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A tab's header: title or month switcher on the left, actions on the right. */
export function TabHeader({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.header, { paddingTop: insets.top }]}>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', minWidth: 0 }}>{children}</View>
      {right}
    </View>
  );
}

export function HeaderButton({ icon, label, onPress, active }: { icon: IconName; label: string; onPress: () => void; active?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={4} style={s.headerButton}>
      <Icon name={icon} color={active ? colors.star : colors.text} />
    </Pressable>
  );
}

export function OnlyYou({ label = 'only you' }: { label?: string }) {
  return (
    <View style={s.onlyYou} accessibilityLabel="Only you can see Money">
      <Icon name="lock" size={12} color={colors.muted} />
      <Text style={s.onlyYouText}>{label}</Text>
    </View>
  );
}

export function MonthSwitcher({ label, onPrev, onNext, prevLabel, nextLabel }: { label: string; onPrev: () => void; onNext: () => void; prevLabel?: string; nextLabel?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Pressable accessibilityRole="button" accessibilityLabel={prevLabel ?? 'Previous month'} onPress={onPrev} style={s.monthArrow}>
        <Text style={s.monthArrowText}>‹</Text>
      </Pressable>
      <Text style={s.monthLabel} numberOfLines={1}>
        {label}
      </Text>
      <Pressable accessibilityRole="button" accessibilityLabel={nextLabel ?? 'Next month'} onPress={onNext} style={s.monthArrow}>
        <Text style={s.monthArrowText}>›</Text>
      </Pressable>
    </View>
  );
}

/** Income · Expenses · Total across the top. */
export function SumsRow({ income, expense, currency, labels = ['Income', 'Expenses', 'Total'] }: { income: number; expense: number; currency: CurrencyCode; labels?: [string, string, string] }) {
  const net = income - expense;
  return (
    <View style={s.sums}>
      <Sum label={labels[0]} value={formatMoney(income, currency)} color={colors.owed} />
      <Sum label={labels[1]} value={formatMoney(expense, currency)} color={colors.owe} />
      <Sum label={labels[2]} value={formatMoney(net, currency, { sign: net < 0 })} color={colors.text} />
    </View>
  );
}

export function Sum({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={s.sum} accessibilityLabel={`${label} ${value}`}>
      <Text style={s.sumLabel}>{label}</Text>
      <Text style={[s.sumValue, { color }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

/** A day in the list: "31 Sat Oct 2026  ₹0  ₹2,176". */
export function DayHeader({ day, income, expense, currency, first }: { day: string; income: number; expense: number; currency: CurrencyCode; first?: boolean }) {
  const [y, m, d] = day.split('-').map(Number);
  return (
    <View style={[s.dayHeader, !first && s.dayGap]} accessibilityRole="header">
      <Text style={s.dayNum}>{d}</Text>
      <Text style={s.dayName}>{weekday(day)}</Text>
      <Text style={s.dayMonth}>
        {shortMonth(m - 1)} {y}
      </Text>
      <Text style={[s.dayAmount, { color: colors.owed }]}>{formatMoney(income, currency)}</Text>
      <Text style={[s.dayAmount, { color: colors.owe, width: 84 }]}>{formatMoney(expense, currency)}</Text>
    </View>
  );
}

const timeOf = (iso: string) => {
  const d = new Date(iso);
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};

/** One thing in Money's list: category on the left, what it was in the middle, the amount on the right. */
export function EntryRow({
  e,
  m,
  onPress,
  groupName,
  showTime,
  showDetails,
  highlight,
}: {
  e: Entry;
  m: MoneyData;
  onPress?: () => void;
  groupName: (id: Id | null) => string;
  showTime?: boolean;
  showDetails?: boolean;
  /** Words to bold (a search). */
  highlight?: string;
}) {
  const acc = (id: Id | null | undefined) => (id ? m.accounts[id]?.name ?? 'Deleted account' : '');
  let left: [string, string | null];
  let title: string;
  let sub: string;
  let color = colors.text;
  switch (e.kind) {
    case 'expense':
    case 'income': {
      const path = categoryPath(m.categories, e.categoryId);
      left = [path[0], path[1] ?? null];
      title = e.note || path[path.length - 1];
      sub = acc(e.accountId);
      color = e.kind === 'income' ? colors.owed : colors.owe;
      break;
    }
    case 'transfer':
      left = ['Transfer', null];
      title = e.note || 'Between your accounts';
      sub = `${acc(e.accountId)} → ${acc(e.toAccountId)}${e.toCurrency && e.toCurrency !== e.currency && e.toAmount !== undefined ? ` · ${formatMoney(e.toAmount, e.toCurrency)}` : ''}`;
      break;
    case 'share': {
      const path = categoryPath(m.categories, e.categoryId);
      left = [e.categoryId === SPLIT_CATEGORY ? 'Shared' : path[0], e.groupLabel ?? groupName(e.groupId)];
      title = e.title ?? '';
      sub = e.info ?? '';
      color = colors.owe;
      break;
    }
    case 'paid':
      left = ['Lent', e.groupLabel ?? groupName(e.groupId)];
      title = e.title ?? '';
      sub = e.info ?? '';
      break;
    case 'settle':
      left = ['Settle-up', e.moved && e.moved > 0 ? 'not income' : 'not spending'];
      title = e.title ?? '';
      sub = e.info ?? '';
      break;
  }
  const details = showDetails && e.details ? e.details : null;
  const label = `${left[0]}${left[1] ? `, ${left[1]}` : ''}. ${title}. ${sub}. ${formatMoney(e.amount, e.currency)}${e.sortOut ? '. Which account?' : ''}`;
  const body = (
    <View style={s.entry}>
      <View style={s.entryLeft}>
        <Text style={s.entryCat} numberOfLines={1}>
          {left[0]}
        </Text>
        {left[1] ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            {e.split ? <Icon name="split" size={10} color={colors.muted} /> : null}
            <Text style={s.entrySubCat} numberOfLines={1}>
              {left[1]}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.entryTitle} numberOfLines={1}>
          <Marked text={title} words={highlight} />
        </Text>
        {sub ? (
          <Text style={s.entrySub} numberOfLines={1}>
            {e.sortOut ? <Text style={{ color: colors.star, fontWeight: '600' }}>Which account? · </Text> : null}
            {showTime ? `${timeOf(e.date)} · ` : ''}
            <Marked text={sub} words={highlight} />
          </Text>
        ) : null}
        {details ? (
          <Text style={s.entrySub} numberOfLines={2}>
            <Marked text={details} words={highlight} />
          </Text>
        ) : null}
      </View>
      <Text style={[s.entryAmount, { color }]}>{formatMoney(e.amount, e.currency)}</Text>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => pressed && { backgroundColor: colors.raised }}>
      {body}
    </Pressable>
  );
}

/** Text with the searched words in bold. */
function Marked({ text, words }: { text: string; words?: string }) {
  const list = (words ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!list.length) return <>{text}</>;
  const re = new RegExp(`(${list.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'ig');
  return (
    <>
      {text.split(re).map((part, i) =>
        list.includes(part.toLowerCase()) ? (
          <Text key={i} style={{ color: colors.star, fontWeight: '700' }}>
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** Where to go when an entry is tapped. */
export function openEntry(nav: unknown, e: Entry) {
  const navigation = nav as Nav;
  if (e.record) return navigation.navigate('Record', { recordId: e.record.id });
  if (e.bill) return navigation.navigate('ExpenseForm', { groupId: e.bill.groupId ?? undefined, expenseId: e.bill.id });
  if (e.payment) return navigation.navigate('SettleUp', { groupId: e.payment.groupId, paymentId: e.payment.id });
  if (e.transfer) {
    if (e.transfer.kind === 'settlement') return navigation.navigate('SortOut');
    return navigation.navigate('Transfer', { transferId: e.transfer.id });
  }
}

/** The round + button for recording something. */
export function Fab({ onPress, label = 'Record a transaction', bottom = 16 }: { onPress: () => void; label?: string; bottom?: number }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [s.fab, { bottom }, pressed && { opacity: 0.85 }]}>
      <Icon name="plus" size={24} color={colors.onStar} />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Sheets

export function Sheet({ visible, onClose, title, children, right }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode; right?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={ui.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[ui.sheet, { paddingBottom: insets.bottom + space.md, maxHeight: '86%' }]}>
        <View style={ui.sheetHandle} />
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingRight: space.md }}>
          <Text style={[ui.sheetTitle, { flex: 1, marginBottom: space.sm }]} accessibilityRole="header">
            {title}
          </Text>
          {right}
        </View>
        {children}
      </View>
    </Modal>
  );
}

/** Pick one of your accounts (or "Don't track"). */
export function AccountSheet({
  visible,
  onClose,
  onPick,
  selected,
  title = 'Account',
  none,
  exclude,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (id: Id | null) => void;
  selected?: Id | null;
  title?: string;
  /** Offer a "none" choice with this label ("Don't track"). */
  none?: { label: string; hint?: string };
  exclude?: Id;
}) {
  const { m, balances } = useMoney();
  const navigation = useNavigation<Nav>();
  const list = sortedAccounts(m).filter((a) => a.id !== exclude);
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <ScrollView style={{ maxHeight: 460 }}>
        {list.map((a) => (
          <SheetRow
            key={a.id}
            title={a.name}
            subtitle={`${ACCOUNT_TYPES.find((t) => t.id === a.type)?.one ?? ''} · ${formatMoney(balances[a.id] ?? 0, a.currency, { sign: (balances[a.id] ?? 0) < 0 })}`}
            selected={selected === a.id}
            onPress={() => {
              onPick(a.id);
              onClose();
            }}
          />
        ))}
        {none ? (
          <SheetRow
            title={none.label}
            subtitle={none.hint}
            selected={selected === null}
            onPress={() => {
              onPick(null);
              onClose();
            }}
          />
        ) : null}
        <SheetRow
          title="+ Add an account"
          accent
          onPress={() => {
            onClose();
            navigation.navigate('AccountForm', {});
          }}
        />
      </ScrollView>
    </Sheet>
  );
}

export function SheetRow({
  title,
  subtitle,
  selected,
  onPress,
  accent,
  right,
  label,
}: {
  title: string;
  subtitle?: string;
  selected?: boolean;
  onPress: () => void;
  accent?: boolean;
  /** Decorative extras on the right (a ›) aren't read out. */
  right?: React.ReactNode;
  label?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ?? (subtitle ? `${title}, ${subtitle}` : title)}
      accessibilityState={{ selected: !!selected }}
      aria-selected={!!selected}
      onPress={onPress}
      style={({ pressed }) => [s.sheetRow, pressed && { backgroundColor: colors.raised }]}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[s.sheetRowTitle, accent && { color: colors.star, fontWeight: '600' }]}>{title}</Text>
        {subtitle ? <Text style={s.sheetRowSub}>{subtitle}</Text> : null}
      </View>
      {right}
      {selected ? <Icon name="check" size={18} color={colors.star} /> : null}
    </Pressable>
  );
}

/**
 * Pick a category. Tapping one with sub-categories opens them (with "Just
 * Car"); you can add a category or a sub-category right here.
 */
export function CategorySheet({
  visible,
  kind,
  selected,
  onPick,
  onClose,
  title = 'Category',
}: {
  visible: boolean;
  kind: CategoryKind;
  selected?: Id | null;
  onPick: (id: Id) => void;
  onClose: () => void;
  title?: string;
}) {
  const { m, saveCategory } = useMoney();
  const navigation = useNavigation<Nav>();
  const [open, setOpen] = useState<Id | null>(null);
  const [adding, setAdding] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  // Each time it opens: start where the chosen category is.
  const [wasVisible, setWasVisible] = useState(false);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      const sel = selected ? m.categories[selected] : undefined;
      setOpen(m.settings.subcategories && sel ? sel.parentId ?? (subCategories(m.categories, sel.id).length ? sel.id : null) : null);
      setAdding('');
      setAddOpen(false);
    }
  }
  const tops = topCategories(m.categories, kind);
  const parent = open ? m.categories[open] : null;
  const subs = open ? subCategories(m.categories, open) : [];
  const pick = (id: Id) => {
    onPick(id);
    onClose();
  };
  const add = () => {
    const name = adding.trim();
    if (!name) return;
    const siblings = parent ? subs : tops;
    const existing = siblings.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (existing) return pick(existing.id);
    const c: Category = { id: uid(), kind, name, parentId: parent?.id ?? null, order: siblings.length ? Math.max(...siblings.map((x) => x.order)) + 1 : 0 };
    saveCategory(c);
    pick(c.id);
  };
  const addBox = (
    <View style={s.addRow}>
      <TextInput
        value={adding}
        onChangeText={setAdding}
        placeholder={parent ? `New sub-category under ${parent.name}` : 'New category'}
        placeholderTextColor={colors.placeholder}
        style={s.addInput}
        accessibilityLabel={parent ? `New sub-category under ${parent.name}` : 'New category'}
        onSubmitEditing={add}
        autoFocus={Platform.OS === 'web'}
        maxLength={40}
      />
      <Pressable accessibilityRole="button" onPress={add} disabled={!adding.trim()} style={[s.addButton, !adding.trim() && { opacity: 0.4 }]}>
        <Text style={s.addButtonText}>Add</Text>
      </Pressable>
    </View>
  );
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={parent ? parent.name : title}
      right={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit categories"
          hitSlop={6}
          onPress={() => {
            onClose();
            navigation.navigate('Categories', { kind });
          }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingBottom: space.sm }}
        >
          <Icon name="edit" size={16} color={colors.star} />
          <Text style={{ color: colors.star, fontWeight: '600', fontSize: 14 }}>Edit</Text>
        </Pressable>
      }
    >
      <ScrollView style={{ maxHeight: 480 }} keyboardShouldPersistTaps="handled">
        {parent ? (
          <>
            <SheetRow title="‹ All categories" onPress={() => setOpen(null)} accent />
            {subs.map((c) => (
              <SheetRow key={c.id} title={c.name} selected={selected === c.id} onPress={() => pick(c.id)} />
            ))}
            <SheetRow title={`Just “${parent.name}”`} selected={selected === parent.id} onPress={() => pick(parent.id)} />
            {addBox}
            <Text style={[ui.hint, { marginHorizontal: space.lg }]}>Add a sub-category right here without leaving what you’re recording.</Text>
          </>
        ) : (
          <>
            {tops.map((c) => {
              const hasSubs = m.settings.subcategories && subCategories(m.categories, c.id).length > 0;
              const selHere = selected === c.id || (!!selected && m.categories[selected]?.parentId === c.id);
              return (
                <SheetRow
                  key={c.id}
                  title={c.name}
                  selected={selHere}
                  onPress={() => (hasSubs ? setOpen(c.id) : pick(c.id))}
                  right={hasSubs ? <Text style={{ color: colors.muted, fontSize: 18, marginRight: 4 }}>›</Text> : undefined}
                />
              );
            })}
            {addOpen ? addBox : <SheetRow title="+ New category" accent onPress={() => setAddOpen(true)} />}
            {m.settings.subcategories && tops.length ? (
              <SheetRow title="+ New sub-category" accent onPress={() => setOpen(tops[0].id)} subtitle="Pick its category first" />
            ) : null}
          </>
        )}
      </ScrollView>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// The amount keypad

const KEYS = ['1', '2', '3', 'back', '4', '5', '6', '−', '7', '8', '9', '+', '00', '0', '.', 'done'];

export function Keypad({ value, onChange, onDone, onClose, title = 'Amount', currency }: { value: string; onChange: (v: string) => void; onDone: () => void; onClose: () => void; title?: string; currency?: string }) {
  const insets = useSafeAreaInsets();
  const sum = hasSum(value);
  // A computer keyboard types into it too.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      let k: string | null = null;
      if (/^[0-9.]$/.test(ev.key)) k = ev.key;
      else if (ev.key === '+') k = '+';
      else if (ev.key === '-') k = '−';
      else if (ev.key === 'Backspace') k = 'back';
      else if (ev.key === 'Enter') k = 'done';
      else if (ev.key === 'Escape') return onClose();
      if (!k) return;
      ev.preventDefault();
      if (k === 'done') onDone();
      else onChange(pressKey(value, k));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [value, onChange, onDone, onClose]);
  return (
    <View style={[s.keypad, { paddingBottom: insets.bottom }]} accessibilityLabel="Amount keypad">
      <View style={s.keypadBar}>
        <Text style={s.keypadTitle}>
          {title}
          {currency ? ` · ${currency}` : ''}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close keypad" onPress={onClose} style={s.keypadClose}>
          <Text style={{ color: colors.textSoft, fontSize: 20 }}>×</Text>
        </Pressable>
      </View>
      <View style={s.keys}>
        {KEYS.map((k, i) => {
          const isDone = k === 'done';
          const label = k === 'back' ? '⌫' : isDone ? (sum ? '=' : 'Done') : k;
          return (
            <Pressable
              key={k}
              accessibilityRole="button"
              accessibilityLabel={k === 'back' ? 'Delete' : k === '−' ? 'Minus' : k === '+' ? 'Plus' : isDone ? (sum ? 'Work it out' : 'Done') : k}
              onPress={() => (isDone ? onDone() : onChange(pressKey(value, k)))}
              style={({ pressed }) => [s.key, (i + 1) % 4 !== 0 && s.keyRight, i < 12 && s.keyBottom, isDone && s.keyDone, pressed && { opacity: 0.6 }]}
            >
              <Text style={[s.keyText, isDone && s.keyDoneText]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// The private line on Split's forms: "Paid from · only you see this · HDFC"

export function PrivateLine({ label, value, onPress, hint, testID }: { label: string; value: string; onPress: () => void; hint?: string; testID?: string }) {
  return (
    <View style={{ marginBottom: space.lg }}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}. Only you see this. Change`}
        onPress={onPress}
        style={({ pressed }) => [s.private, pressed && { backgroundColor: colors.raised }]}
      >
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={s.privateLabel}>{label}</Text>
            <OnlyYou label="only you see this" />
          </View>
          <Text style={s.privateValue} numberOfLines={1}>
            {value}
          </Text>
        </View>
        <Text style={s.privateChange}>Change</Text>
      </Pressable>
      {hint ? <Text style={ui.hint}>{hint}</Text> : null}
    </View>
  );
}

/** A one-time "NEW HERE" tip. */
export function Tip({ text, onDone }: { text: string; onDone: () => void }) {
  return (
    <View style={s.tip} accessibilityRole="alert">
      <Text style={s.tipLead}>NEW HERE</Text>
      <Text style={s.tipText}>{text}</Text>
      <Pressable accessibilityRole="button" onPress={onDone} style={s.tipButton}>
        <Text style={s.tipButtonText}>Got it</Text>
      </Pressable>
    </View>
  );
}

export const monthTitle = (m: number, y: number, now = new Date()) => (y === now.getFullYear() ? monthName(m) : `${shortMonth(m)} ${y}`);

/** A short account label: "HDFC Savings", or "Don't track". */
export const accountLabel = (m: MoneyData, id: Id | null | undefined) => (id === null ? 'Don’t track' : id ? m.accounts[id]?.name ?? 'Deleted account' : 'Choose an account');

export type { Account };

export const s = StyleSheet.create({
  tabBar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.space },
  tab: { flex: 1, height: 60, alignItems: 'center', justifyContent: 'center', gap: 3 },
  tabText: { fontSize: 12, fontWeight: '500', color: colors.muted },
  tabTextOn: { color: colors.star, fontWeight: '700' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xs, minHeight: 52, backgroundColor: colors.space },
  headerTitle: { fontFamily: fonts.medium, fontSize: 18, color: colors.text, paddingHorizontal: space.md },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  onlyYou: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 4 },
  onlyYouText: { fontSize: 11, color: colors.muted },
  monthArrow: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  monthArrowText: { fontSize: 24, color: colors.text, lineHeight: 28 },
  monthLabel: { fontFamily: fonts.medium, fontSize: 16, color: colors.text, flexShrink: 1 },
  sums: { flexDirection: 'row', height: 58, borderBottomWidth: 1, borderBottomColor: colors.line, alignItems: 'center' },
  sum: { flex: 1, alignItems: 'center', gap: 3, paddingHorizontal: 4 },
  sumLabel: { fontSize: 12, color: colors.textSoft },
  sumValue: { fontSize: 15, fontWeight: '600' },
  dayHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 12, paddingBottom: 8, paddingHorizontal: space.lg, borderBottomWidth: 1, borderBottomColor: colors.line },
  dayGap: { borderTopWidth: 6, borderTopColor: colors.surface, paddingTop: 14 },
  dayNum: { fontFamily: fonts.medium, fontSize: 22, color: colors.text },
  dayName: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: colors.line, fontSize: 11, fontWeight: '600', color: colors.textSoft, overflow: 'hidden' },
  dayMonth: { flex: 1, fontSize: 12, color: colors.muted },
  dayAmount: { fontSize: 13, textAlign: 'right' },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: space.lg, minHeight: 52 },
  entryLeft: { width: 84 },
  entryCat: { fontSize: 12, color: colors.textSoft },
  entrySubCat: { fontSize: 11, color: colors.muted, flexShrink: 1 },
  entryTitle: { fontSize: 14, color: colors.text },
  entrySub: { fontSize: 12, color: colors.muted, marginTop: 1 },
  entryAmount: { fontSize: 14, fontWeight: '600' },
  fab: {
    position: 'absolute',
    right: space.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.star,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48, paddingVertical: 10, paddingHorizontal: space.lg },
  sheetRowTitle: { fontSize: 15, color: colors.text },
  sheetRowSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm },
  addInput: { flex: 1, height: 44, borderRadius: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.raised, color: colors.text, paddingHorizontal: space.md, fontSize: 15 },
  addButton: { height: 44, paddingHorizontal: space.lg, borderRadius: 10, backgroundColor: colors.star, alignItems: 'center', justifyContent: 'center' },
  addButtonText: { color: colors.onStar, fontWeight: '700', fontSize: 14 },
  keypad: { backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.line },
  keypadBar: { height: 42, flexDirection: 'row', alignItems: 'center', paddingLeft: space.lg, backgroundColor: colors.raised },
  keypadTitle: { flex: 1, fontSize: 14, color: colors.textSoft },
  keypadClose: { width: 44, height: 42, alignItems: 'center', justifyContent: 'center' },
  keys: { flexDirection: 'row', flexWrap: 'wrap' },
  key: { width: '25%', height: 54, alignItems: 'center', justifyContent: 'center' },
  keyRight: { borderRightWidth: 1, borderRightColor: colors.line },
  keyBottom: { borderBottomWidth: 1, borderBottomColor: colors.line },
  keyText: { fontSize: 22, color: colors.text },
  keyDone: { backgroundColor: colors.star },
  keyDoneText: { color: colors.onStar, fontSize: 16, fontWeight: '700', fontFamily: fonts.medium },
  private: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, paddingHorizontal: space.lg, paddingVertical: space.md },
  privateLabel: { fontSize: 13, fontWeight: '600', color: colors.muted },
  privateValue: { fontSize: 15, color: colors.text, marginTop: 3 },
  privateChange: { color: colors.star, fontWeight: '600', fontSize: 14, marginLeft: space.md },
  tip: { marginBottom: space.lg, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(242, 196, 109, 0.45)', backgroundColor: colors.starSoft, padding: space.md, gap: 6 },
  tipLead: { fontSize: 11, fontWeight: '700', color: colors.star, letterSpacing: 0.6 },
  tipText: { fontSize: 13, lineHeight: 19, color: colors.text },
  tipButton: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: colors.star, marginTop: 2 },
  tipButtonText: { color: colors.onStar, fontWeight: '700', fontSize: 13 },
});
