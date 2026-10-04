// Friend requests: people who opened your friend link and asked to be
// friends. You accept or decline each one.
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { approveFriendRequest, declineFriendRequest, myFriendCode, resetFriendCode } from './cloud/api';
import { friendLink } from './cloud/config';
import { shareNote, ShareLink } from './invites';
import { friendRequestMessage } from './messages';
import { shareText } from './share';
import { useStore } from './store';
import { colors, space } from './theme';
import { Avatar, Button, List, SectionTitle } from './ui';

/** Requests sent to you, with Accept and Decline. Nothing when there are none. */
export function IncomingFriendRequests() {
  const { state, userId, refresh } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const incoming = (state.friendRequests ?? []).filter((r) => r.toUser === userId);
  if (incoming.length === 0) return null;

  const decide = async (id: string, accept: boolean) => {
    setBusy(id);
    setError(null);
    try {
      if (accept) await approveFriendRequest(id);
      else await declineFriendRequest(id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t work. Try again.');
    }
    setBusy(null);
  };

  return (
    <View style={{ marginBottom: space.lg }}>
      <SectionTitle>Friend requests</SectionTitle>
      <List>
        {incoming.map((r, i) => {
          const p = state.people[r.fromPerson];
          const name = p?.name ?? 'Someone';
          return (
            <View key={r.id} style={[s.row, i < incoming.length - 1 && s.divider]}>
              <Avatar name={name} size={32} />
              <View style={{ flex: 1, marginLeft: space.md, marginRight: space.sm }}>
                <Text style={s.name}>{name}</Text>
                <Text style={s.sub}>{busy === r.id ? 'Saving…' : p?.email ?? 'Opened your friend link'}</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: space.xs }}>
                <Button
                  small
                  title="Decline"
                  variant="ghost"
                  disabled={!!busy}
                  accessibilityLabel={`Decline ${name}`}
                  onPress={() => decide(r.id, false)}
                />
                <Button
                  small
                  title="Accept"
                  disabled={!!busy}
                  accessibilityLabel={`Accept ${name}`}
                  onPress={() => decide(r.id, true)}
                />
              </View>
            </View>
          );
        })}
      </List>
      <Text style={s.note}>{error ?? 'They opened your friend link. Accept to be friends on both sides.'}</Text>
    </View>
  );
}

/** Your friend link with a Share button, to send on WhatsApp. */
export function MyFriendLink() {
  const { state } = useStore();
  const [code, setCode] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const me = state.meId ? state.people[state.meId] : undefined;

  useEffect(() => {
    let live = true;
    myFriendCode()
      .then((c) => live && setCode(c))
      .catch((e) => live && setError(e instanceof Error ? e.message : 'Couldn’t make your friend link.'));
    return () => {
      live = false;
    };
  }, []);

  const link = code ? friendLink(code) : null;
  return (
    <View>
      <ShareLink
        link={link}
        accessibilityLabel="Share your friend link"
        onShare={async () => {
          if (!link) return;
          setNote(shareNote(await shareText(friendRequestMessage({ name: me?.name ?? 'me', link })), link));
        }}
      />
      <Text style={s.note}>
        {error ??
          note ??
          'Share opens your phone’s share menu: pick WhatsApp, then the chat. When they open it and accept, you get a notification to confirm, and you’re friends on both sides.'}
      </Text>
      {code ? (
        <Button
          small
          title="Make a new link"
          variant="ghost"
          style={{ alignSelf: 'flex-start', marginTop: space.xs }}
          accessibilityLabel="Make a new friend link (the old one stops working)"
          onPress={async () => {
            try {
              setCode(await resetFriendCode());
              setNote('New link ready. The old one no longer works.');
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Couldn’t make a new link.');
            }
          }}
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: space.lg },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  name: { fontSize: 15, color: colors.text },
  sub: { fontSize: 12, color: colors.muted, marginTop: 2, lineHeight: 16 },
  note: { fontSize: 12, color: colors.muted, marginTop: space.sm, marginHorizontal: space.xs, lineHeight: 16 },
});
