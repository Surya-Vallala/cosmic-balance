import React, { useEffect, useLayoutEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth';
import { groupPreview, joinGroup, type GroupPreview } from '../cloud/api';
import type { ScreenProps } from '../navigation';
import { useStore } from '../store';
import { colors, fonts, space } from '../theme';
import { Avatar, Button, Empty, GroupBadge, List, Row, Screen, SectionTitle, styles as ui } from '../ui';

/** Opened from an invite link: join the group, optionally as the person already added for you. */
export default function JoinScreen({ navigation, route }: ScreenProps<'Join'>) {
  const { code } = route.params;
  const { refresh, state } = useStore();
  const { clearPendingJoin } = useAuth();
  const [preview, setPreview] = useState<GroupPreview | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({ title: 'Join a group' });
  }, [navigation]);

  useEffect(() => {
    clearPendingJoin();
    groupPreview(code)
      .then(setPreview)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [code, clearPendingJoin]);

  const join = async (claim: string | null) => {
    setBusy(claim ?? 'new');
    setError(null);
    try {
      const groupId = await joinGroup(code, claim);
      await refresh();
      navigation.replace('Group', { groupId });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  if (preview === undefined && !error) {
    return (
      <Screen>
        <Text style={s.loading}>Looking up the invite…</Text>
      </Screen>
    );
  }

  if (!preview) {
    return (
      <Screen>
        <Empty
          title="This invite link doesn't work"
          body={error ?? 'It may have been replaced with a new one. Ask whoever sent it for a fresh link.'}
          action={<Button title="Go to my groups" variant="secondary" onPress={() => navigation.popToTop()} />}
        />
      </Screen>
    );
  }

  if (preview.is_member) {
    return (
      <Screen>
        <View style={s.head}>
          <GroupBadge name={preview.name} size={64} />
          <Text style={s.title}>You’re already in {preview.name}</Text>
        </View>
        <Button title="Open the group" onPress={() => navigation.replace('Group', { groupId: preview.id })} />
      </Screen>
    );
  }

  const me = state.meId ? state.people[state.meId] : undefined;
  const unclaimed = preview.members.filter((m) => !m.claimed);
  const joined = preview.members.filter((m) => m.claimed);

  return (
    <Screen>
      <View style={s.head}>
        <GroupBadge name={preview.name} size={64} />
        <Text style={s.title}>Join {preview.name}</Text>
        {joined.length ? (
          <Text style={s.meta}>With {joined.map((m) => m.name).join(', ')}</Text>
        ) : null}
      </View>

      {unclaimed.length > 0 ? (
        <>
          <SectionTitle>Which one is you?</SectionTitle>
          <Text style={[ui.hint, { marginTop: 0, marginBottom: space.md }]}>
            If someone already added you to this group by name, pick it. Everything they recorded for you will be
            linked to your account.
          </Text>
          <List>
            {unclaimed.map((m, i) => (
              <Row
                key={m.id}
                left={<Avatar name={m.name} size={36} />}
                title={`I'm ${m.name}`}
                subtitle={busy === m.id ? 'Joining…' : undefined}
                onPress={busy ? undefined : () => join(m.id)}
                last={i === unclaimed.length - 1}
              />
            ))}
          </List>
        </>
      ) : null}

      <View style={{ marginTop: space.xl }}>
        <Button
          title={busy === 'new' ? 'Joining…' : unclaimed.length ? "I'm not on this list: join as me" : `Join as ${me?.name ?? 'me'}`}
          variant={unclaimed.length ? 'secondary' : 'primary'}
          disabled={!!busy}
          onPress={() => join(null)}
        />
      </View>
      {error ? <Text style={[ui.error, { textAlign: 'center' }]}>{error}</Text> : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  loading: { fontSize: 15, color: colors.muted, textAlign: 'center', marginTop: space.xxl },
  head: { alignItems: 'center', marginTop: space.lg, marginBottom: space.lg, gap: space.md },
  title: { fontFamily: fonts.light, fontSize: 26, color: colors.text, textAlign: 'center' },
  meta: { fontSize: 14, color: colors.muted, textAlign: 'center' },
});
