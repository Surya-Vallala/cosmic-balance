// The starry opening shared by the welcome and set-up screens.
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Libra } from '../cosmos';
import { colors, fonts, space } from '../theme';
import { OrbitMark, Starfield } from '../ui';

export function WelcomeHero() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.hero, { paddingTop: insets.top + space.xxl * 1.5 }]}>
      <Starfield count={40} seed={11} />
      <Libra width={170} opacity={0.8} style={{ position: 'absolute', right: space.lg, top: insets.top + space.xxl * 2.4 }} />
      <OrbitMark size={56} />
      <Text style={s.wordmark}>{'cosmic\nbalance'}</Text>
      <Text style={s.lede}>Share costs with friends anywhere on the planet, and keep everything in balance.</Text>
      <View style={s.ledger}>
        <LedgerLine left="Dinner in Bangkok" right="฿1,860" />
        <LedgerLine left="Ravi owes you" right="₹1,250" tone="owed" />
        <LedgerLine left="You owe Priya" right="₹350" tone="owe" last />
      </View>
    </View>
  );
}

export function StudioCredit() {
  return (
    <View style={s.credit}>
      <Text style={s.creditText}>Developed by</Text>
      <Image
        source={require('../../assets/tesseract-logo-light.png')}
        style={s.creditLogo}
        resizeMode="contain"
        accessibilityLabel="Tesseract Studio"
      />
    </View>
  );
}

function LedgerLine({ left, right, tone, last }: { left: string; right: string; tone?: 'owed' | 'owe'; last?: boolean }) {
  const color = tone === 'owed' ? colors.owed : tone === 'owe' ? colors.owe : colors.text;
  return (
    <View style={[s.ledgerLine, !last && s.ledgerRule]}>
      <Text style={[s.ledgerText, { color: tone ? color : colors.textSoft }]}>{left}</Text>
      <Text style={[s.ledgerAmount, { color }]}>{right}</Text>
    </View>
  );
}

export const sheetStyle = StyleSheet.create({
  sheet: {
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    padding: space.xl,
  },
}).sheet;

const s = StyleSheet.create({
  hero: { paddingHorizontal: space.xl, paddingBottom: space.xxl },
  wordmark: { fontFamily: fonts.light, fontSize: 52, lineHeight: 56, color: colors.text, letterSpacing: -1, marginTop: space.xl },
  lede: { fontSize: 17, lineHeight: 25, color: colors.textSoft, marginTop: space.md, maxWidth: 330 },
  ledger: { marginTop: space.xl, borderLeftWidth: 1, borderLeftColor: colors.star, paddingLeft: space.lg },
  ledgerLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 },
  ledgerRule: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  ledgerText: { fontSize: 15 },
  ledgerAmount: { fontFamily: fonts.medium, fontSize: 15 },
  credit: { alignItems: 'center', marginTop: space.xl, gap: 8 },
  creditText: { fontSize: 11, color: colors.muted, letterSpacing: 0.4 },
  creditLogo: { width: 140, height: 23, opacity: 0.85 },
});
