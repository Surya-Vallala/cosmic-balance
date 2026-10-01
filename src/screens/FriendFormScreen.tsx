import React, { useLayoutEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth';
import { exportCsv } from '../export';
import type { ScreenProps } from '../navigation';
import { uid, useStore } from '../store';
import { colors, fonts, space } from '../theme';
import { Avatar, Button, ConfirmButton, Field, List, Row, Screen, SectionTitle, styles as ui } from '../ui';

const UPI_PATTERN = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/;

export default function FriendFormScreen({ navigation, route }: ScreenProps<'FriendForm'>) {
  const { state, dispatch, mode, email } = useStore();
  const { signOut, backToWelcome } = useAuth();
  const existing = route.params.personId ? state.people[route.params.personId] : undefined;
  const isMe = existing?.id === state.meId;
  // In shared mode, people with their own account manage their own details.
  const readOnly = mode === 'cloud' && !!existing && !isMe && !!existing.userId;

  const [name, setName] = useState(existing?.name ?? '');
  const [upi, setUpi] = useState(existing?.upiId ?? '');
  const [touched, setTouched] = useState(false);
  const [exported, setExported] = useState<string | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: isMe ? 'Your profile' : readOnly ? existing?.name ?? 'Friend' : existing ? 'Edit friend' : 'Add a friend',
    });
  }, [navigation, existing, isMe, readOnly]);

  const upiTrim = upi.trim();
  const nameError = touched && !name.trim() ? 'Enter a name.' : null;
  const upiError = touched && upiTrim && !UPI_PATTERN.test(upiTrim) ? 'A UPI ID looks like name@bank, for example ravi@okaxis.' : null;

  const save = () => {
    setTouched(true);
    if (!name.trim() || (upiTrim && !UPI_PATTERN.test(upiTrim))) return;
    dispatch({
      type: 'savePerson',
      person: { ...(existing ?? {}), id: existing?.id ?? uid(), name: name.trim(), upiId: upiTrim || undefined },
    });
    navigation.goBack();
  };

  if (readOnly && existing) {
    return (
      <Screen>
        <View style={s.readHead}>
          <Avatar name={existing.name} size={72} />
          <Text style={s.readName}>{existing.name}</Text>
          {existing.upiId ? <Text style={s.readUpi}>UPI: {existing.upiId}</Text> : null}
        </View>
        <Text style={[ui.hint, { textAlign: 'center' }]}>
          {existing.name} has their own Cosmic Khaata account and manages their own name and UPI ID.
        </Text>
      </Screen>
    );
  }

  return (
    <Screen footer={<Button title={existing ? 'Save changes' : 'Add friend'} onPress={save} />}>
      <Field
        label={isMe ? 'Your name' : 'Name'}
        value={name}
        onChangeText={setName}
        placeholder="Ravi"
        autoCapitalize="words"
        error={nameError}
        hint={!isMe && mode === 'cloud' ? 'When they join with an invite link, they take over this name with everything recorded for them.' : undefined}
      />
      <Field
        label="UPI ID (optional)"
        value={upi}
        onChangeText={setUpi}
        placeholder="name@bank"
        autoCapitalize="none"
        autoCorrect={false}
        error={upiError}
        hint={
          isMe
            ? 'Shown to friends so they can pay you from their UPI app.'
            : 'Lets you open your UPI app with their ID and the amount filled in when you settle up.'
        }
      />

      {isMe ? (
        <>
          {mode === 'cloud' ? (
            <>
              <SectionTitle>Account</SectionTitle>
              <Text style={[ui.hint, { marginTop: 0, marginBottom: space.md }]}>
                Signed in as {email ?? 'your Google account'}. Your groups are saved online and shared with the friends in them.
              </Text>
              <Button title="Sign out" variant="secondary" onPress={signOut} />
            </>
          ) : (
            <>
              <SectionTitle>Share with friends</SectionTitle>
              <Text style={[ui.hint, { marginTop: 0, marginBottom: space.md }]}>
                Right now everything is on this phone only. Sign in with Google to share groups with friends. What’s on
                this phone stays here and isn’t moved to your account.
              </Text>
              <Button title="Sign in with Google" variant="secondary" onPress={backToWelcome} />
            </>
          )}

          <SectionTitle>Your data</SectionTitle>
          <Text style={[ui.hint, { marginTop: 0, marginBottom: space.md }]}>
            {mode === 'cloud'
              ? 'Export a spreadsheet of everything you can see, to keep your own copy.'
              : 'Everything is stored on this phone. Export a spreadsheet now and then to keep a copy.'}
          </Text>
          <Button
            title="Export to spreadsheet"
            variant="secondary"
            onPress={async () => {
              try {
                setExported(await exportCsv(state));
              } catch {
                setExported("Couldn't export. Try again.");
              }
            }}
          />
          {exported ? <Text style={ui.hint}>{exported}</Text> : null}

          <SectionTitle>About</SectionTitle>
          <List>
            <Row
              title="About Cosmic Khaata"
              subtitle="Developed by Tesseract Studio. Send suggestions and questions."
              right={<Text style={{ color: colors.muted, fontSize: 22 }}>›</Text>}
              onPress={() => navigation.navigate('About')}
              last
            />
          </List>

          {mode === 'local' ? (
            <View style={{ marginTop: space.xxl }}>
              <Text style={[ui.hint, { marginBottom: space.sm }]}>
                Erasing removes all groups, friends, expenses and transfers from this phone.
              </Text>
              <ConfirmButton title="Erase all data" confirmTitle="Tap again to erase everything" onConfirm={() => dispatch({ type: 'reset' })} />
            </View>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  readHead: { alignItems: 'center', marginTop: space.lg, marginBottom: space.xl, gap: space.sm },
  readName: { fontFamily: fonts.light, fontSize: 26, color: colors.text },
  readUpi: { fontSize: 14, color: colors.muted },
});
