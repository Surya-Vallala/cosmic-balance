import React, { useLayoutEffect, useState } from 'react';
import { Text, View } from 'react-native';
import type { ScreenProps } from '../navigation';
import { uid, useStore } from '../store';
import { exportCsv } from '../export';
import { colors, space } from '../theme';
import { Button, ConfirmButton, Field, List, Row, Screen, SectionTitle, styles as ui } from '../ui';

const UPI_PATTERN = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/;

export default function FriendFormScreen({ navigation, route }: ScreenProps<'FriendForm'>) {
  const { state, dispatch } = useStore();
  const existing = route.params.personId ? state.people[route.params.personId] : undefined;
  const isMe = existing?.id === state.meId;

  const [name, setName] = useState(existing?.name ?? '');
  const [upi, setUpi] = useState(existing?.upiId ?? '');
  const [touched, setTouched] = useState(false);
  const [exported, setExported] = useState<string | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({ title: isMe ? 'Your profile' : existing ? 'Edit friend' : 'Add a friend' });
  }, [navigation, existing, isMe]);

  const upiTrim = upi.trim();
  const nameError = touched && !name.trim() ? 'Enter a name.' : null;
  const upiError = touched && upiTrim && !UPI_PATTERN.test(upiTrim) ? 'A UPI ID looks like name@bank, for example ravi@okaxis.' : null;

  const save = () => {
    setTouched(true);
    if (!name.trim() || (upiTrim && !UPI_PATTERN.test(upiTrim))) return;
    dispatch({
      type: 'savePerson',
      person: { id: existing?.id ?? uid(), name: name.trim(), upiId: upiTrim || undefined },
    });
    navigation.goBack();
  };

  return (
    <Screen footer={<Button title={existing ? 'Save changes' : 'Add friend'} onPress={save} />}>
      <Field
        label={isMe ? 'Your name' : 'Name'}
        value={name}
        onChangeText={setName}
        placeholder="Ravi"
        autoCapitalize="words"
        error={nameError}
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
          <SectionTitle>Your data</SectionTitle>
          <Text style={[ui.hint, { marginTop: 0, marginBottom: space.md }]}>
            Everything is stored on this phone. Export a spreadsheet now and then to keep a copy.
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

          <View style={{ marginTop: space.xxl }}>
            <Text style={[ui.hint, { marginBottom: space.sm }]}>Erasing removes all groups, friends, expenses and transfers from this phone.</Text>
            <ConfirmButton title="Erase all data" confirmTitle="Tap again to erase everything" onConfirm={() => dispatch({ type: 'reset' })} />
          </View>
        </>
      ) : null}
    </Screen>
  );
}
