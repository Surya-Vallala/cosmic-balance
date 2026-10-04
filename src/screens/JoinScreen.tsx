import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth';
import {
  claimPersonInvite,
  CloudError,
  groupPreview,
  personInvitePreview,
  requestJoin,
  type GroupPreview,
  type PersonInvitePreview,
} from '../cloud/api';
import type { ScreenProps } from '../navigation';
import { PushCard } from '../notify-ui';
import { useStore } from '../store';
import { colors, fonts, space } from '../theme';
import { Avatar, Button, Empty, GroupBadge, Screen, styles as ui } from '../ui';

/** Opened from an invite link: a group's link, or a personal one sent to one friend. */
export default function JoinScreen({ navigation, route }: ScreenProps<'Join'>) {
  if (route.params.invite) return <PersonInvite code={route.params.invite} navigation={navigation} />;
  return <GroupInvite code={route.params.code ?? ''} navigation={navigation} />;
}

type Nav = ScreenProps<'Join'>['navigation'];

/** A personal invite: accept it to become the person your friend added, with everything recorded for them. */
function PersonInvite({ code, navigation }: { code: string; navigation: Nav }) {
  const { refresh } = useStore();
  const { clearPendingInvite } = useAuth();
  const [preview, setPreview] = useState<PersonInvitePreview | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [busy, setBusy] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({ title: 'Your invite' });
  }, [navigation]);

  const fetchPreview = useCallback(() => {
    personInvitePreview(code)
      .then((p) => {
        setPreview(p);
        clearPendingInvite();
      })
      .catch((e) => {
        const retry = e instanceof CloudError && e.retry;
        setError(e instanceof Error ? e.message : String(e));
        setCanRetry(retry);
        setPreview(null);
        if (!retry) clearPendingInvite();
      });
  }, [code, clearPendingInvite]);

  useEffect(() => {
    fetchPreview();
  }, [fetchPreview]);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const groupId = await claimPersonInvite(code);
      await refresh();
      if (groupId) navigation.replace('Group', { groupId });
      else navigation.popToTop();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  if (preview === undefined && !error) {
    return (
      <Screen>
        <Text style={s.loading}>Looking up your invite…</Text>
      </Screen>
    );
  }

  if (!preview) {
    return (
      <Screen>
        <Empty
          title={canRetry ? 'Couldn’t open the invite' : 'This invite link doesn’t work'}
          body={error ?? 'It may have been used already. Ask whoever sent it to invite you again.'}
          action={
            <View style={{ gap: space.sm }}>
              {canRetry ? (
                <Button
                  title="Try again"
                  onPress={() => {
                    setError(null);
                    setCanRetry(false);
                    setPreview(undefined);
                    fetchPreview();
                  }}
                />
              ) : null}
              <Button title="Go to my groups" variant="secondary" onPress={() => navigation.popToTop()} />
            </View>
          }
        />
      </Screen>
    );
  }

  if (preview.mine) {
    return (
      <Screen>
        <Empty
          title={`This is your invite for ${preview.name}`}
          body={`Send it to ${preview.name} on WhatsApp. When they open it and sign in, everything you recorded for them becomes theirs.`}
          action={<Button title="Go to my groups" variant="secondary" onPress={() => navigation.popToTop()} />}
        />
      </Screen>
    );
  }

  const groups = preview.groups;
  const where =
    groups.length === 0
      ? 'You’ll be friends on Cosmic Balance, so you can record money between you.'
      : `You’ll join ${groups.length === 1 ? groups[0] : `${groups.slice(0, -1).join(', ')} and ${groups[groups.length - 1]}`}, with everything already recorded for you.`;

  return (
    <Screen>
      <View style={s.head}>
        <Avatar name={preview.name} size={64} />
        <Text style={s.title}>
          {preview.invited_by} added you as “{preview.name}”
        </Text>
        <Text style={s.meta}>{where}</Text>
      </View>
      <Button title={busy ? 'Joining…' : 'Accept invite'} disabled={busy} onPress={accept} />
      <View style={{ marginTop: space.sm }}>
        <Button
          title="This isn’t me"
          variant="ghost"
          disabled={busy}
          onPress={() => navigation.popToTop()}
        />
      </View>
      {error ? <Text style={[ui.error, { textAlign: 'center' }]}>{error}</Text> : null}
    </Screen>
  );
}

/** A group's link: ask to join; whoever created the group lets you in. */
function GroupInvite({ code, navigation }: { code: string; navigation: Nav }) {
  const { refresh } = useStore();
  const { clearPendingJoin } = useAuth();
  const [preview, setPreview] = useState<GroupPreview | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [canRetry, setCanRetry] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({ title: 'Join a group' });
  }, [navigation]);

  // Keep the invite until we know whether it works, so a dropped connection doesn't lose it.
  const fetchPreview = useCallback(() => {
    groupPreview(code)
      .then((p) => {
        setPreview(p);
        clearPendingJoin();
      })
      .catch((e) => {
        const retry = e instanceof CloudError && e.retry;
        setError(e instanceof Error ? e.message : String(e));
        setCanRetry(retry);
        setPreview(null);
        if (!retry) clearPendingJoin();
      });
  }, [code, clearPendingJoin]);

  useEffect(() => {
    fetchPreview();
  }, [fetchPreview]);

  const load = () => {
    setError(null);
    setCanRetry(false);
    setPreview(undefined);
    fetchPreview();
  };

  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await requestJoin(code);
      if (res.status === 'member') {
        await refresh();
        navigation.replace('Group', { groupId: res.group_id });
        return;
      }
      setPreview((p) => (p ? { ...p, requested: true } : p));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
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
          title={canRetry ? 'Couldn’t open the invite' : 'This invite link doesn’t work'}
          body={error ?? 'It may have been replaced with a new one. Ask whoever sent it for a fresh link.'}
          action={
            <View style={{ gap: space.sm }}>
              {canRetry ? <Button title="Try again" onPress={load} /> : null}
              <Button title="Go to my groups" variant="secondary" onPress={() => navigation.popToTop()} />
            </View>
          }
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
        <Button
          title="Open the group"
          onPress={async () => {
            await refresh();
            navigation.replace('Group', { groupId: preview.id });
          }}
        />
      </Screen>
    );
  }

  const owner = preview.owner ?? 'the group';
  const count = preview.member_count ?? 0;

  if (preview.requested) {
    return (
      <Screen>
        <View style={s.head}>
          <GroupBadge name={preview.name} size={64} />
          <Text style={s.title}>Request sent</Text>
          <Text style={s.meta}>
            {owner} will see that you asked to join {preview.name}. Once they let you in, the group shows up in your
            groups.
          </Text>
        </View>
        <PushCard hideWhenOn />
        <View style={{ marginTop: space.lg }}>
          <Button title="Go to my groups" variant="secondary" onPress={() => navigation.popToTop()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={s.head}>
        <GroupBadge name={preview.name} size={64} />
        <Text style={s.title}>Join {preview.name}</Text>
        <Text style={s.meta}>
          {count ? `${count} ${count === 1 ? 'person' : 'people'} · ` : ''}run by {owner}
        </Text>
      </View>
      <Button title={busy ? 'Asking…' : 'Ask to join'} disabled={busy} onPress={ask} />
      <Text style={[ui.hint, { textAlign: 'center', marginTop: space.md }]}>
        {owner} lets people in. If they already added you by name, they’ll link you to it, with everything recorded for
        you.
      </Text>
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
