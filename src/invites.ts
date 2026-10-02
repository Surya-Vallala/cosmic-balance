// Personal WhatsApp invites for friends who haven't joined yet.
import { useEffect, useState } from 'react';
import { Linking } from 'react-native';
import { personInviteLink } from './cloud/config';
import { phonesFor } from './phones';
import { useStore } from './store';
import type { Person } from './types';
import { inviteMessage, whatsAppUrl } from './whatsapp';

/** Open WhatsApp. Call straight from a tap: phones block windows opened later. */
export function openWhatsApp(text: string, phone?: string | null): void {
  Linking.openURL(whatsAppUrl(text, phone)).catch(() => {});
}

/**
 * Gets each person's invite link ready in advance, so a tap can open WhatsApp
 * straight away (phones block windows opened after waiting on the network).
 */
export function useWhatsAppInvites(people: Person[]) {
  const { inviteCodes, mode, state } = useStore();
  const key = people.map((p) => p.id).join(',');
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [phones, setPhones] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'cloud' || !key) return;
    let live = true;
    const ids = key.split(',');
    inviteCodes(ids)
      .then((c) => {
        if (live) {
          setCodes(c);
          setError(null);
        }
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : 'Couldn’t make the invite link.'));
    phonesFor(ids).then((p) => live && setPhones(p));
    return () => {
      live = false;
    };
  }, [key, mode, inviteCodes]);

  /** Open WhatsApp with this person's invite. False if their link isn't ready yet. */
  const invite = (p: Person): boolean => {
    const code = codes[p.id];
    if (!code) return false;
    const groups = state.groups.filter((g) => g.memberIds.includes(p.id)).map((g) => g.name);
    openWhatsApp(inviteMessage({ friend: p.name, groups, link: personInviteLink(code) }), phones[p.id]);
    return true;
  };

  return { ready: (id: string) => !!codes[id], hasPhone: (id: string) => !!phones[id], invite, error };
}
