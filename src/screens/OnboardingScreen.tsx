import React, { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { uid, useStore } from '../store';
import { colors, fonts, space } from '../theme';
import { Libra } from '../cosmos';
import { Button, Field, OrbitMark, Starfield } from '../ui';

export default function OnboardingScreen() {
  const { dispatch } = useStore();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [upi, setUpi] = useState('');
  const [touched, setTouched] = useState(false);

  const trimmed = name.trim();
  const start = (withSample: boolean) => {
    setTouched(true);
    if (!trimmed) return;
    dispatch({ type: 'setup', me: { id: uid(), name: trimmed, upiId: upi.trim() || undefined } });
    if (withSample) dispatch({ type: 'loadSample' });
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.space }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <View style={[s.hero, { paddingTop: insets.top + space.xxl * 1.5 }]}>
          <Starfield count={40} seed={11} />
          <Libra width={170} opacity={0.8} style={{ position: 'absolute', right: space.lg, top: insets.top + space.xxl * 2.4 }} />
          <OrbitMark size={40} />
          <Text style={s.wordmark}>{'cosmic\nkhaata'}</Text>
          <Text style={s.lede}>Share costs with friends anywhere on the planet, and keep the khaata balanced.</Text>
          <View style={s.ledger}>
            <LedgerLine left="Dinner in Bangkok" right="฿1,860" />
            <LedgerLine left="Ravi owes you" right="₹1,250" tone="owed" />
            <LedgerLine left="You owe Priya" right="₹350" tone="owe" last />
          </View>
        </View>

        <View style={[s.sheet, { paddingBottom: insets.bottom + space.xl }]}>
          <Field
            label="Your name"
            value={name}
            onChangeText={setName}
            placeholder="What your friends call you"
            autoCapitalize="words"
            returnKeyType="next"
            error={touched && !trimmed ? 'Enter your name to continue.' : null}
          />
          <Field
            label="Your UPI ID (optional)"
            value={upi}
            onChangeText={setUpi}
            placeholder="name@bank"
            autoCapitalize="none"
            autoCorrect={false}
            hint="Friends can pay you straight from their UPI app."
          />
          <Button title="Get started" onPress={() => start(false)} />
          <Button title="Explore with sample friends" variant="ghost" onPress={() => start(true)} style={{ marginTop: space.sm }} />
          <View style={s.credit}>
            <Text style={s.creditText}>Developed by</Text>
            <Image source={require('../../assets/tesseract-logo-light.png')} style={s.creditLogo} resizeMode="contain" accessibilityLabel="Tesseract Studio" />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
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

const s = StyleSheet.create({
  hero: { paddingHorizontal: space.xl, paddingBottom: space.xxl },
  wordmark: {
    fontFamily: fonts.light,
    fontSize: 52,
    lineHeight: 56,
    color: colors.text,
    letterSpacing: -1,
    marginTop: space.xl,
  },
  lede: { fontSize: 17, lineHeight: 25, color: colors.textSoft, marginTop: space.md, maxWidth: 330 },
  ledger: { marginTop: space.xl, borderLeftWidth: 1, borderLeftColor: colors.star, paddingLeft: space.lg },
  ledgerLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 },
  ledgerRule: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  ledgerText: { fontSize: 15 },
  ledgerAmount: { fontFamily: fonts.medium, fontSize: 15 },
  credit: { alignItems: 'center', marginTop: space.xl, gap: 8 },
  creditText: { fontSize: 11, color: colors.muted, letterSpacing: 0.4 },
  creditLogo: { width: 140, height: 23, opacity: 0.85 },
  sheet: {
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    padding: space.xl,
  },
});
