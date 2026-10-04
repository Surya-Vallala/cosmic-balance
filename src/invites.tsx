// Invite links, shared through the phone's own share menu (pick WhatsApp,
// then the chat or group to send it to).
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { personInviteLink } from './cloud/config';
import { inviteMessage } from './messages';
import { shareText, type ShareResult } from './share';
import { useStore } from './store';
import { colors, radius, space } from './theme';
import type { Person } from './types';
import { Button } from './ui';

/**
 * Gets each person's invite link ready in advance, so a tap can open the share
 * menu straight away (phones only open it in direct response to a tap).
 */
export function useInviteLinks(people: Person[]) {
  const { inviteCodes, mode, state } = useStore();
  const key = people.map((p) => p.id).join(',');
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'cloud' || !key) return;
    let live = true;
    inviteCodes(key.split(','))
      .then((c) => {
        if (live) {
          setCodes(c);
          setLoaded(key);
          setError(null);
        }
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : 'Couldn’t make the invite link.'));
    return () => {
      live = false;
    };
  }, [key, mode, inviteCodes]);

  const link = (id: string): string | null => (codes[id] ? personInviteLink(codes[id]) : null);

  /** Open the share menu with this person's invite. Null if their link isn't ready yet. */
  const share = (p: Person): Promise<ShareResult> | null => {
    const l = link(p.id);
    if (!l) return null;
    const groups = state.groups.filter((g) => g.memberIds.includes(p.id)).map((g) => g.name);
    return shareText(inviteMessage({ friend: p.name, groups, link: l }));
  };

  return {
    ready: (id: string) => !!codes[id],
    /**
     * No link for them: they're also in a group you aren't in, so only
     * whoever added them can send their invite.
     */
    unavailable: (id: string) => loaded === key && !codes[id],
    link,
    share,
    error,
  };
}

/** What happened after tapping Share, in words (null when the share menu opened). */
export function shareNote(result: ShareResult, link: string): string | null {
  if (result === 'copied') return 'Link copied. Paste it into WhatsApp or any chat.';
  if (result === 'failed') return `Copy this link and send it: ${link}`;
  return null;
}

/** A link with a Share button beside it. */
export function ShareLink({
  link,
  onShare,
  label = 'Share',
  accessibilityLabel,
}: {
  link: string | null;
  onShare: () => void;
  label?: string;
  accessibilityLabel?: string;
}) {
  return (
    <View style={s.box}>
      <Text style={s.link} numberOfLines={1} selectable>
        {link ? link.replace(/^https?:\/\//, '') : 'Making the link…'}
      </Text>
      <Button
        small
        title={label}
        onPress={onShare}
        disabled={!link}
        accessibilityLabel={accessibilityLabel}
        style={{ minHeight: 40 }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingLeft: space.md,
    paddingRight: 6,
    paddingVertical: 6,
  },
  link: { flex: 1, minWidth: 0, fontSize: 13, color: colors.textSoft },
});
