import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth';
import { uid, useStore } from '../store';
import { colors, space } from '../theme';
import { Button, Field, styles as ui } from '../ui';
import { sheetStyle, StudioCredit, WelcomeHero } from './WelcomeHero';

/** Set-up for using the app on this phone only (no account). */
export default function OnboardingScreen() {
  const { dispatch } = useStore();
  const { backToWelcome } = useAuth();
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
        <WelcomeHero />
        <View style={[sheetStyle, { paddingBottom: insets.bottom + space.xl }]}>
          <Text style={[ui.hint, { marginTop: 0, marginBottom: space.lg }]}>
            Using Cosmic Khaata on this phone only. Nothing is shared or saved online.
          </Text>
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
          <Button title="Sign in with Google instead" variant="ghost" onPress={backToWelcome} />
          <StudioCredit />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
