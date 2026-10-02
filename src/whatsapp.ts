// WhatsApp links with a message ready to send (pure functions, no app code).
// WhatsApp never sends by itself: the person taps Send.

/**
 * A phone number in the international form WhatsApp links need (digits only,
 * country code first). Numbers without a country code are taken as Indian.
 * Returns null if it doesn't look like a phone number.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;
  if (trimmed.startsWith('+')) {
    // already international
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = `91${digits.slice(1)}`; // 098765 43210
  } else if (digits.length === 10) {
    digits = `91${digits}`; // 98765 43210
  }
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/** wa.me link: straight to that person's chat if the number is known, else WhatsApp asks who to send it to. */
export function whatsAppUrl(text: string, phone?: string | null): string {
  const to = normalizePhone(phone);
  return `https://wa.me/${to ?? ''}?text=${encodeURIComponent(text)}`;
}

/** The message for a friend's personal invite. */
export function inviteMessage(opts: { friend: string; groups: string[]; link: string }): string {
  const first = opts.friend.includes('@') ? '' : ` ${opts.friend.split(/\s+/)[0]}`;
  const where =
    opts.groups.length === 0
      ? 'as a friend on Cosmic Khaata'
      : opts.groups.length === 1
        ? `to “${opts.groups[0]}” on Cosmic Khaata`
        : `to ${opts.groups
            .slice(0, -1)
            .map((g) => `“${g}”`)
            .join(', ')} and “${opts.groups[opts.groups.length - 1]}” on Cosmic Khaata`;
  return `Hi${first}! I’ve added you ${where}, so we can split our expenses. Tap to join (sign in with Google): ${opts.link}`;
}
