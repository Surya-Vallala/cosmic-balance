// Picking friends from the phone's contacts (Chrome on Android). The phone
// shows its own picker and shares only the contacts chosen, nothing else.
// Not available on iPhone or computers: callers hide the button there.

export interface PickedContact {
  name: string;
  phone: string | null;
  email: string | null;
}

interface ContactsManager {
  select(props: string[], options?: { multiple?: boolean }): Promise<{ name?: string[]; tel?: string[]; email?: string[] }[]>;
}

function manager(): ContactsManager | null {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return null;
  const m = (navigator as Navigator & { contacts?: ContactsManager }).contacts;
  return m && 'ContactsManager' in window && typeof m.select === 'function' ? m : null;
}

export function canPickContacts(): boolean {
  return manager() !== null;
}

/** Ask the phone for one or more contacts. Resolves to [] if the picker was closed. */
export async function pickContacts(multiple: boolean): Promise<PickedContact[]> {
  const m = manager();
  if (!m) return [];
  try {
    const picked = await m.select(['name', 'tel', 'email'], { multiple });
    return picked
      .map((c) => {
        const emails = (c.email ?? []).map((e) => e.trim()).filter(Boolean);
        return {
          name: (c.name ?? []).map((n) => n.trim()).find(Boolean) ?? '',
          phone: (c.tel ?? []).map((t) => t.trim()).find(Boolean) ?? null,
          // A Gmail address links their account; prefer it over any other email.
          email: emails.find((e) => /@(gmail|googlemail)\.com$/i.test(e)) ?? emails[0] ?? null,
        };
      })
      .filter((c) => c.name || c.email || c.phone);
  } catch {
    return [];
  }
}
