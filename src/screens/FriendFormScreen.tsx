import React, { useLayoutEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth';
import { isEmail } from '../emails';
import { exportCsv } from '../export';
import type { ScreenProps } from '../navigation';
import { uid, useStore } from '../store';
import { colors, fonts, space } from '../theme';
import { Avatar, Button, ConfirmButton, Field, List, Row, Screen, SectionTitle, styles as ui } from '../ui';

const UPI_PATTERN = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/;

export default function FriendFormScreen({ navigation, route }: ScreenProps<'FriendForm'>) {
  const { state, dispatch, mode, email, addPersonByEmail, setPersonEmail, unsaved } = useStore();
  const { signOut, backToWelcome } = useAuth();
  const existing = route.params.personId ? state.people[route.params.personId] : undefined;
  const isMe = existing?.id === state.meId;
  // In shared mode, people with their own account manage their own details.
  const readOnly = mode === 'cloud' && !!existing && !isMe && !!existing.userId;

  const [name, setName] = useState(existing?.name ?? '');
  const [upi, setUpi] = useState(existing?.upiId ?? '');
  const [touched, setTouched] = useState(false);
  const [exported, setExported] = useState<string | null>(null);
  // Shared mode: a friend's Gmail links them to their account.
  const showGmail = mode === 'cloud' && !isMe && !existing?.userId;
  const [gmail, setGmail] = useState(existing?.email ?? '');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: isMe ? 'Your profile' : readOnly ? existing?.name ?? 'Friend' : existing ? 'Edit friend' : 'Add a friend',
    });
  }, [navigation, existing, isMe, readOnly]);

  const upiTrim = upi.trim();
  const gmailTrim = showGmail ? gmail.trim() : '';
  const nameMissing = !name.trim() && !(showGmail && !existing && gmailTrim);
  const nameError = touched && nameMissing ? 'Enter a name.' : null;
  const upiError = touched && upiTrim && !UPI_PATTERN.test(upiTrim) ? 'A UPI ID looks like name@bank, for example ravi@okaxis.' : null;
  const gmailError = touched && gmailTrim && !isEmail(gmailTrim) ? 'An email address looks like name@gmail.com.' : null;

  const save = async () => {
    setTouched(true);
    setSaveError(null);
    if (nameMissing || (upiTrim && !UPI_PATTERN.test(upiTrim)) || (gmailTrim && !isEmail(gmailTrim))) return;

    // New friend with a Gmail: their account if they have one, else linked when they sign in.
    if (showGmail && !existing && gmailTrim) {
      setBusy(true);
      try {
        const p = await addPersonByEmail(gmailTrim, name.trim() || undefined);
        if (upiTrim && !p.userId && !p.upiId) dispatch({ type: 'savePerson', person: { ...p, upiId: upiTrim } });
        navigation.goBack();
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : 'Couldn’t add them. Try again.');
        setBusy(false);
      }
      return;
    }

    const id = existing?.id ?? uid();
    const changed = !existing || existing.name !== name.trim() || (existing.upiId ?? '') !== upiTrim;
    if (changed) {
      dispatch({
        type: 'savePerson',
        person: { ...(existing ?? {}), id, name: name.trim(), upiId: upiTrim || undefined },
      });
    }
    if (showGmail && existing && gmailTrim !== (existing.email ?? '')) {
      setBusy(true);
      try {
        const now = await setPersonEmail(existing.id, gmailTrim);
        if (now !== existing.id) {
          // They already had an account: everything recorded for this name is now theirs.
          navigation.popToTop();
          navigation.navigate('Friend', { friendId: now });
          return;
        }
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : 'Couldn’t save the email. Try again.');
        setBusy(false);
        return;
      }
    }
    navigation.goBack();
  };

  if (readOnly && existing) {
    return (
      <Screen>
        <View style={s.readHead}>
          <Avatar name={existing.name} size={72} />
          <Text style={s.readName}>{existing.name}</Text>
          {existing.email ? <Text style={s.readUpi}>{existing.email}</Text> : null}
          {existing.upiId ? <Text style={s.readUpi}>UPI: {existing.upiId}</Text> : null}
        </View>
        <Text style={[ui.hint, { textAlign: 'center' }]}>
          {existing.name} has their own Cosmic Khaata account and manages their own name and UPI ID.
        </Text>
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        <Button title={busy ? 'Saving…' : existing ? 'Save changes' : 'Add friend'} onPress={save} disabled={busy} />
      }
    >
      <Field
        label={isMe ? 'Your name' : 'Name'}
        value={name}
        onChangeText={setName}
        placeholder="Ravi"
        autoCapitalize="words"
        error={nameError}
      />
      {showGmail ? (
        <Field
          label="Gmail address"
          value={gmail}
          onChangeText={setGmail}
          placeholder="ravi@gmail.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          error={gmailError}
          hint={
            existing
              ? 'When they sign in with this Gmail, they take over this name with everything recorded for them. If they already use Cosmic Khaata, that happens straight away.'
              : 'The email they sign in with. If they already use Cosmic Khaata they’re added as themselves; if not, they’re linked as soon as they sign in. Without it, they only show up for you until they join with an invite link.'
          }
        />
      ) : null}
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
      {saveError ? <Text style={ui.error}>{saveError}</Text> : null}

      {isMe ? (
        <>
          {mode === 'cloud' ? (
            <>
              <SectionTitle>Account</SectionTitle>
              <Text style={[ui.hint, { marginTop: 0, marginBottom: space.md }]}>
                Signed in as {email ?? 'your Google account'}. Your groups are saved online and shared with the friends in them.
                {unsaved > 0
                  ? ` ${unsaved} change${unsaved === 1 ? ' hasn’t' : 's haven’t'} been sent yet; if you sign out, ${unsaved === 1 ? 'it goes' : 'they go'} out the next time you sign in on this phone.`
                  : ''}
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
