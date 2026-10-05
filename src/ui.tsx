import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlackHole } from './cosmos';
import { dayLabel, toDay } from './dates';
import { fromBase, groupCurrencies } from './logic';
import { currency, formatMoney } from './money';
import { colors, fonts, radius, space, tintFor } from './theme';
import type { CurrencyCode, Group, Totals } from './types';

/**
 * A main-currency amount written in the group's other currencies:
 * "฿1,567.94", or "฿1,567.94 or $47" for three currencies. Empty for
 * single-currency groups.
 */
export function equivalents(group: Group, baseAmount: number): string {
  return groupCurrencies(group)
    .slice(1)
    .map((c) => formatMoney(fromBase(group, Math.abs(baseAmount), c), c))
    .join(' or ');
}

/** "฿1 = ₹2.87" */
export function rateText(group: Group, code: CurrencyCode): string {
  return `${formatMoney(100, code)} = ${symbolPrefix(group.baseCurrency)}${group.rates[code]}`;
}

/** "₹", "฿" or "AED " — a symbol ready to sit in front of a number. */
export function symbolPrefix(code: CurrencyCode): string {
  const sym = currency(code).symbol;
  return /^[A-Z]{2,}$/.test(sym) ? `${sym} ` : sym;
}

// ---------------------------------------------------------------------------
// Layout

export function Screen({
  children,
  footer,
  contentStyle,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.space }}>
      <ScrollView
        contentContainerStyle={[{ padding: space.lg, paddingBottom: space.xxl + insets.bottom }, contentStyle]}
        keyboardShouldPersistTaps="handled"
        // On the web app any scroll (even the browser keeping the cursor in
        // view while you type) would close the keyboard, so only on native.
        keyboardDismissMode={Platform.OS === 'web' ? 'none' : 'on-drag'}
      >
        {children}
      </ScrollView>
      {footer ? (
        <View style={[styles.footer, { paddingBottom: space.md + insets.bottom }]}>
          {footerItems(footer).map((item, i) => (
            <View key={i} style={{ flex: 1 }}>
              {item}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function footerItems(footer: React.ReactNode): React.ReactNode[] {
  if (React.isValidElement(footer) && footer.type === React.Fragment) {
    return React.Children.toArray((footer.props as { children?: React.ReactNode }).children);
  }
  return [footer];
}

// ---------------------------------------------------------------------------
// Cosmic motifs

/** Seeded star positions, so the field is the same on every render. */
function makeStars(count: number, seed: number) {
  let x = seed;
  const rnd = () => {
    x = (x * 16807) % 2147483647;
    return (x - 1) / 2147483646;
  };
  return Array.from({ length: count }, () => {
    const size = rnd() < 0.85 ? 1.5 : 2.5;
    return {
      left: `${rnd() * 100}%` as const,
      top: `${rnd() * 100}%` as const,
      size,
      opacity: 0.2 + rnd() * 0.6,
      warm: rnd() < 0.12,
    };
  });
}

/** A sparse, fixed starfield. Positions come from a seed so they never jump. */
export function Starfield({ count = 28, seed = 7 }: { count?: number; seed?: number }) {
  const stars = useMemo(() => makeStars(count, seed), [count, seed]);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {stars.map((st, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: st.left,
            top: st.top,
            width: st.size,
            height: st.size,
            borderRadius: st.size,
            opacity: st.opacity,
            backgroundColor: st.warm ? colors.star : colors.text,
          }}
        />
      ))}
    </View>
  );
}

/** Logo mark: a ring with a small moon on it. */
export function OrbitMark({ size = 18 }: { size?: number }) {
  const moon = Math.max(5, size * 0.32);
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 1.5,
          borderColor: colors.star,
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: moon,
          height: moon,
          borderRadius: moon / 2,
          backgroundColor: colors.star,
          right: size * 0.146 - moon / 2,
          top: size * 0.146 - moon / 2,
        }}
      />
    </View>
  );
}

export function Wordmark({ size = 18 }: { size?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: size * 0.5 }}>
      <OrbitMark size={size * 1.05} />
      <Text style={{ fontFamily: fonts.medium, fontSize: size, color: colors.text, letterSpacing: 0.2 }}>
        cosmic balance
      </Text>
    </View>
  );
}

/** A group's badge: a small planet inside a faint orbit, with a moon. */
export function GroupBadge({ name, size = 40 }: { name: string; size?: number }) {
  const planet = size * 0.62;
  const moon = Math.max(4, size * 0.12);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 1,
          borderColor: colors.line,
        }}
      />
      <View
        style={{
          width: planet,
          height: planet,
          borderRadius: planet / 2,
          backgroundColor: tintFor(name),
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: '#fff', fontFamily: fonts.medium, fontSize: planet * 0.45 }}>
          {name.trim()[0]?.toUpperCase() ?? '#'}
        </Text>
      </View>
      <View
        style={{
          position: 'absolute',
          width: moon,
          height: moon,
          borderRadius: moon / 2,
          backgroundColor: colors.star,
          right: size * 0.146 - moon / 2,
          top: size * 0.146 - moon / 2,
        }}
      />
    </View>
  );
}

export function Avatar({ name, size = 40 }: { id?: string; name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: tintFor(name),
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: '#fff', fontFamily: fonts.medium, fontSize: size * 0.38 }}>{initials || '?'}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Controls

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  style,
  small,
  accessibilityLabel,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
  accessibilityLabel?: string;
}) {
  const v = buttonVariants[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: v.bg, borderColor: v.border },
        pressed && { opacity: 0.75 },
        disabled && { opacity: 0.35 },
        style,
      ]}
    >
      <Text style={[styles.buttonText, small && { fontSize: 13 }, { color: v.fg }]}>{title}</Text>
    </Pressable>
  );
}

const buttonVariants: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.star, fg: colors.onStar, border: colors.star },
  secondary: { bg: 'transparent', fg: colors.text, border: colors.line },
  ghost: { bg: 'transparent', fg: colors.textSoft, border: 'transparent' },
  danger: { bg: 'transparent', fg: colors.owe, border: colors.owe },
};

/** A destructive button that asks for a second tap instead of a popup. */
export function ConfirmButton({ title, confirmTitle, onConfirm }: { title: string; confirmTitle: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onConfirm();
      }}
      style={({ pressed }) => [
        styles.button,
        { borderColor: colors.owe, backgroundColor: armed ? colors.owe : 'transparent' },
        pressed && { opacity: 0.75 },
      ]}
    >
      <Text style={[styles.buttonText, { color: armed ? colors.space : colors.owe }]}>{armed ? confirmTitle : title}</Text>
    </Pressable>
  );
}

export function Field({ label, hint, error, style, ...props }: TextInputProps & { label: string; hint?: string; error?: string | null }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ marginBottom: space.lg }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.placeholder}
        keyboardAppearance="dark"
        selectionColor={colors.star}
        {...props}
        onFocus={(e) => {
          setFocused(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          props.onBlur?.(e);
        }}
        style={[styles.input, focused && { borderColor: colors.star }, error ? { borderColor: colors.owe } : null, style]}
      />
      {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

/**
 * A day, shown as "Today" or "Fri, 2 Oct". Tapping it opens the phone's own
 * calendar (on the web app); elsewhere, arrows step a day at a time.
 * `value` and `max` are calendar days like "2026-10-05".
 */
export function DateField({
  label,
  value,
  onChange,
  max = toDay(),
}: {
  label: string;
  value: string;
  onChange: (day: string) => void;
  max?: string;
}) {
  const shown = dayLabel(value);
  if (Platform.OS === 'web') {
    return (
      <View>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.dateBox}>
          <Text style={styles.dateText}>{shown}</Text>
          <Text style={styles.dateChange}>Change</Text>
          {React.createElement('input', {
            type: 'date',
            value,
            max,
            'aria-label': `${label}: ${shown}. Change`,
            onChange: (e: { target: { value: string } }) => {
              if (e.target.value) onChange(e.target.value > max ? max : e.target.value);
            },
            // Open the calendar wherever the row is tapped (not just on the icon).
            onClick: (e: { currentTarget: { showPicker?: () => void } }) => {
              try {
                e.currentTarget.showPicker?.();
              } catch {
                // some browsers only allow it in certain states; the tap still focuses the field
              }
            },
            style: {
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              opacity: 0,
              border: 0,
              padding: 0,
              margin: 0,
              cursor: 'pointer',
              colorScheme: 'dark',
            },
          })}
        </View>
      </View>
    );
  }
  const step = (days: number) => {
    const [y, m, d] = value.split('-').map(Number);
    const next = toDay(new Date(y, m - 1, d + days));
    if (next <= max) onChange(next);
  };
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.dateBox}>
        <Pressable accessibilityRole="button" accessibilityLabel="Day before" onPress={() => step(-1)} hitSlop={8}>
          <Text style={styles.dateChange}>‹</Text>
        </Pressable>
        <Text style={[styles.dateText, { textAlign: 'center' }]}>{shown}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Day after" onPress={() => step(1)} hitSlop={8} disabled={value >= max}>
          <Text style={[styles.dateChange, value >= max && { opacity: 0.3 }]}>›</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Small right-aligned number input used in lists. */
export function SmallInput(props: TextInputProps) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      placeholderTextColor={colors.placeholder}
      keyboardAppearance="dark"
      selectionColor={colors.star}
      keyboardType="decimal-pad"
      placeholder="0"
      {...props}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[styles.smallInput, focused && { borderColor: colors.star }, props.style]}
    />
  );
}

export function Chip({ label, selected, onPress, leading }: { label: string; selected: boolean; onPress: () => void; leading?: React.ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipOn]}
    >
      {leading}
      <Text style={[styles.chipText, selected && { color: colors.space }]}>{label}</Text>
    </Pressable>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, on && styles.segmentOn]}
          >
            <Text style={[styles.segmentText, on && { color: colors.text }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Currency picking

/** The tappable currency label inside an amount box: "฿ THB ▾". */
export function CurrencyButton({
  code,
  onPress,
  large,
}: {
  code: CurrencyCode;
  onPress?: () => void;
  large?: boolean;
}) {
  const c = currency(code);
  const content = (
    <View style={[styles.currencyBtn, large && { paddingVertical: 10 }, !onPress && { borderColor: 'transparent' }]}>
      <Text style={[styles.currencySymbol, large && { fontSize: 22 }]}>{c.symbol}</Text>
      {onPress ? (
        <>
          <Text style={styles.currencyCode}>{c.code}</Text>
          <Text style={styles.caret}>▾</Text>
        </>
      ) : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Currency: ${c.name}. Change currency`} hitSlop={6}>
      {content}
    </Pressable>
  );
}

/** The big amount field: a currency button and the number, with a focus ring. */
export function AmountInput({
  code,
  onPressCurrency,
  value,
  onChangeText,
  invalid,
  accessibilityLabel,
  fontSize = 40,
}: {
  code: CurrencyCode;
  onPressCurrency?: () => void;
  value: string;
  onChangeText: (v: string) => void;
  invalid?: boolean;
  accessibilityLabel: string;
  fontSize?: number;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.amountBox, focused && { borderColor: colors.star }, invalid ? { borderColor: colors.owe } : null]}>
      <CurrencyButton code={code} large onPress={onPressCurrency} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="0"
        placeholderTextColor={colors.placeholder}
        keyboardType="decimal-pad"
        keyboardAppearance="dark"
        selectionColor={colors.star}
        style={[styles.amountInput, { fontSize }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null]}
        accessibilityLabel={accessibilityLabel}
      />
    </View>
  );
}

/** Bottom sheet listing currencies to choose from. */
export function CurrencyPicker({
  visible,
  title,
  options,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: CurrencyCode[];
  selected?: CurrencyCode;
  onSelect: (code: CurrencyCode) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + space.md }]}>
        <View style={styles.sheetHandle} />
        <Text style={styles.sheetTitle}>{title}</Text>
        <ScrollView style={{ maxHeight: 420 }}>
          {options.map((code, i) => {
            const c = currency(code);
            const on = code === selected;
            return (
              <Pressable
                key={code}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => {
                  onSelect(code);
                  onClose();
                }}
                style={({ pressed }) => [
                  styles.sheetRow,
                  i < options.length - 1 && styles.rowDivider,
                  pressed && { backgroundColor: colors.raised },
                ]}
              >
                <View style={styles.sheetSymbol}>
                  <Text style={styles.sheetSymbolText} numberOfLines={1} adjustsFontSizeToFit>
                    {c.symbol}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{c.name}</Text>
                  <Text style={styles.rowSubtitle}>{c.code}</Text>
                </View>
                {on ? <Text style={{ color: colors.star, fontSize: 18 }}>✓</Text> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Lists and text

export function Row({
  left,
  title,
  subtitle,
  right,
  onPress,
  last,
  titleLines = 1,
  note,
}: {
  titleLines?: number;
  left?: React.ReactNode;
  title: string;
  subtitle?: string;
  /** An extra line under the subtitle, like an expense's remarks. */
  note?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  last?: boolean;
}) {
  const content = (
    <View style={[styles.row, !last && styles.rowDivider]}>
      {left ? <View style={{ marginRight: space.md }}>{left}</View> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.rowTitle, titleLines > 1 && { fontWeight: '400', lineHeight: 21 }]} numberOfLines={titleLines}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSubtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
        {note ? (
          <Text style={styles.rowNote} numberOfLines={1}>
            {note.replace(/\s+/g, ' ').trim()}
          </Text>
        ) : null}
      </View>
      {right ? <View style={{ marginLeft: space.md, alignItems: 'flex-end' }}>{right}</View> : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && { backgroundColor: colors.raised }}>
      {content}
    </Pressable>
  );
}

export function List({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.list, style]}>{children}</View>;
}

export function SectionTitle({ children, action }: { children: string; action?: React.ReactNode }) {
  return (
    <View style={styles.sectionTitleRow}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {action}
    </View>
  );
}

/** "owes you ₹450" / "you owe ₹450" / "settled up", coloured by direction. */
export function BalanceTag({
  amount,
  currency: code = 'INR',
  kind = 'friend',
  align = 'right',
}: {
  amount: number;
  currency?: CurrencyCode;
  kind?: 'friend' | 'group' | 'member';
  align?: 'left' | 'right';
}) {
  if (amount === 0) return <Text style={[styles.balanceLabel, { color: colors.muted, textAlign: align }]}>settled up</Text>;
  const owed = amount > 0;
  const label = owed
    ? kind === 'friend'
      ? 'owes you'
      : kind === 'member'
        ? 'gets back'
        : "you're owed"
    : kind === 'member'
      ? 'owes'
      : 'you owe';
  return (
    <View style={{ alignItems: align === 'right' ? 'flex-end' : 'flex-start' }}>
      <Text style={[styles.balanceLabel, { color: owed ? colors.owed : colors.owe }]}>{label}</Text>
      <Text style={[styles.balanceAmount, { color: owed ? colors.owed : colors.owe }]}>
        {formatMoney(Math.abs(amount), code)}
      </Text>
    </View>
  );
}

/** Balance with a friend that may span currencies (from different groups). */
export function TotalsTag({ totals }: { totals: Totals }) {
  const entries = Object.entries(totals)
    .filter(([, v]) => v !== 0)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  if (entries.length === 0) return <BalanceTag amount={0} />;
  if (entries.length === 1) return <BalanceTag amount={entries[0][1]} currency={entries[0][0]} />;
  return (
    <View style={{ alignItems: 'flex-end', gap: 2 }}>
      {entries.map(([c, v]) => (
        <Text key={c} style={[styles.balanceAmount, { fontSize: 14, color: v > 0 ? colors.owed : colors.owe }]}>
          {v > 0 ? 'owes you ' : 'you owe '}
          {formatMoney(Math.abs(v), c)}
        </Text>
      ))}
    </View>
  );
}

export function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <View style={styles.empty}>
      <BlackHole size={96} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {action ? <View style={{ marginTop: space.lg, alignSelf: 'stretch' }}>{action}</View> : null}
    </View>
  );
}

export const styles = StyleSheet.create({
  footer: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    backgroundColor: colors.space,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    flexDirection: 'row',
    gap: space.sm,
  },
  button: {
    minHeight: 50,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSmall: { minHeight: 34, borderRadius: radius.sm, paddingHorizontal: space.md },
  buttonText: { fontFamily: fonts.medium, fontSize: 15, letterSpacing: 0.2 },
  label: { fontSize: 13, fontWeight: '600', color: colors.muted, marginBottom: 8, letterSpacing: 0.2 },
  input: {
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    fontSize: 17,
    color: colors.text,
  },
  smallInput: {
    width: 92,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingVertical: 8,
    paddingHorizontal: 10,
    fontSize: 16,
    color: colors.text,
    textAlign: 'right',
    backgroundColor: colors.raised,
  },
  hint: { fontSize: 13, color: colors.muted, marginTop: 6, lineHeight: 18 },
  dateBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    minHeight: 50,
    overflow: 'hidden',
  },
  dateText: { flex: 1, fontSize: 17, color: colors.text },
  dateChange: { fontFamily: fonts.medium, fontSize: 14, color: colors.star },
  error: { fontSize: 13, color: colors.owe, marginTop: 6, fontWeight: '600' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chipOn: { backgroundColor: colors.text, borderColor: colors.text },
  chipText: { fontSize: 15, color: colors.text, fontWeight: '500' },
  segmented: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.md, padding: 3, borderWidth: 1, borderColor: colors.line },
  segment: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: radius.sm },
  segmentOn: { backgroundColor: colors.raised },
  segmentText: { fontSize: 14, fontWeight: '600', color: colors.muted },
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
  amountInput: { flex: 1, minWidth: 0, fontFamily: fonts.light, color: colors.text, paddingVertical: 6 },
  currencyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
  },
  currencySymbol: { fontFamily: fonts.medium, fontSize: 18, color: colors.textSoft },
  currencyCode: { fontSize: 13, fontWeight: '600', color: colors.textSoft },
  caret: { fontSize: 11, color: colors.muted, marginTop: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(3, 4, 14, 0.6)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: colors.line,
    paddingTop: space.sm,
  },
  sheetHandle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.line, marginBottom: space.md },
  sheetTitle: { fontFamily: fonts.medium, fontSize: 17, color: colors.text, paddingHorizontal: space.lg, marginBottom: space.sm },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 12, paddingHorizontal: space.lg },
  sheetSymbol: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  sheetSymbolText: { fontFamily: fonts.medium, fontSize: 15, color: colors.text },
  list: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: space.lg },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  rowTitle: { fontSize: 16, color: colors.text, fontWeight: '600' },
  rowSubtitle: { fontSize: 13, color: colors.muted, marginTop: 2 },
  rowNote: { fontSize: 13, color: colors.textSoft, fontStyle: 'italic', marginTop: 2 },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.xl,
    marginBottom: space.sm,
  },
  sectionTitle: { fontFamily: fonts.medium, fontSize: 15, color: colors.textSoft, letterSpacing: 0.2 },
  balanceLabel: { fontSize: 12, fontWeight: '600' },
  balanceAmount: { fontFamily: fonts.medium, fontSize: 15 },
  empty: { alignItems: 'center', paddingVertical: space.xxl, paddingHorizontal: space.lg },
  emptyTitle: { fontFamily: fonts.medium, fontSize: 18, color: colors.text, textAlign: 'center', marginTop: space.lg },
  emptyBody: { fontSize: 15, color: colors.muted, textAlign: 'center', marginTop: 6, lineHeight: 21 },
});
