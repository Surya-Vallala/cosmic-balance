import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth';
import { colors, fonts, space } from '../theme';
import { Button, styles as ui } from '../ui';
import { sheetStyle, StudioCredit, WelcomeHero } from './WelcomeHero';

/** First screen: sign in to share with friends, or use the app on this phone only. */
export default function WelcomeScreen() {
  const { signInWithGoogle, chooseThisPhoneOnly, authError, pendingJoin } = useAuth();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.space }} contentContainerStyle={{ flexGrow: 1 }}>
      <WelcomeHero />
      <View style={[sheetStyle, { paddingBottom: insets.bottom + space.xl }]}>
        {pendingJoin ? (
          <View style={s.invite}>
            <Text style={s.inviteTitle}>You’ve been invited to a group</Text>
            <Text style={s.inviteBody}>Sign in with Google to join it and see what’s been shared.</Text>
          </View>
        ) : null}

        <Button
          title={busy ? 'Opening Google…' : 'Continue with Google'}
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            await signInWithGoogle();
            setBusy(false);
          }}
        />
        <Text style={s.note}>Your groups are saved online and shared with the friends in them.</Text>
        {authError ? <Text style={ui.error}>{authError}</Text> : null}

        {!pendingJoin ? (
          <>
            <View style={s.or}>
              <View style={s.rule} />
              <Text style={s.orText}>or</Text>
              <View style={s.rule} />
            </View>
            <Button title="Use on this phone only" variant="secondary" onPress={chooseThisPhoneOnly} />
            <Text style={s.note}>No account. Everything stays on this phone and can’t be shared with friends.</Text>
          </>
        ) : null}

        <StudioCredit />
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  note: { fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: space.sm, lineHeight: 18 },
  or: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginVertical: space.xl },
  rule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
  orText: { fontSize: 12, color: colors.muted },
  invite: {
    borderWidth: 1,
    borderColor: colors.star,
    borderRadius: 16,
    padding: space.lg,
    marginBottom: space.lg,
    backgroundColor: colors.starSoft,
  },
  inviteTitle: { fontFamily: fonts.medium, fontSize: 16, color: colors.text },
  inviteBody: { fontSize: 14, color: colors.textSoft, marginTop: 4, lineHeight: 20 },
});
