import { describe, expect, it } from 'vitest';
import { inviteMessage, normalizePhone, whatsAppUrl } from './whatsapp';

describe('normalizePhone', () => {
  it('turns Indian numbers as saved in contacts into international form', () => {
    expect(normalizePhone('98765 43210')).toBe('919876543210');
    expect(normalizePhone('098765-43210')).toBe('919876543210');
    expect(normalizePhone('+91 98765 43210')).toBe('919876543210');
    expect(normalizePhone('0091 98765 43210')).toBe('919876543210');
  });

  it('keeps other countries’ numbers when they have a + code', () => {
    expect(normalizePhone('+66 81 234 5678')).toBe('66812345678');
    expect(normalizePhone('+1 (415) 555-0100')).toBe('14155550100');
  });

  it('rejects things that are not phone numbers', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('ravi')).toBeNull();
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe('whatsAppUrl', () => {
  it('opens the person’s chat when the number is known', () => {
    expect(whatsAppUrl('Hi & bye', '98765 43210')).toBe('https://wa.me/919876543210?text=Hi%20%26%20bye');
  });

  it('lets WhatsApp ask who to send it to otherwise', () => {
    expect(whatsAppUrl('Hi')).toBe('https://wa.me/?text=Hi');
    expect(whatsAppUrl('Hi', 'not a number')).toBe('https://wa.me/?text=Hi');
  });
});

describe('inviteMessage', () => {
  const link = 'https://example.org/?invite=abc';

  it('names the group and greets the friend by first name', () => {
    expect(inviteMessage({ friend: 'Ravi Kumar', groups: ['Goa weekend'], link })).toBe(
      `Hi Ravi! I’ve added you to “Goa weekend” on Cosmic Khaata, so we can split our expenses. Tap to join (sign in with Google): ${link}`,
    );
  });

  it('lists several groups, or none for a friend outside groups', () => {
    expect(inviteMessage({ friend: 'Priya', groups: ['Goa', 'Flat 302', 'Thailand'], link })).toContain(
      'to “Goa”, “Flat 302” and “Thailand” on Cosmic Khaata',
    );
    expect(inviteMessage({ friend: 'Priya', groups: [], link })).toContain('as a friend on Cosmic Khaata');
  });

  it('doesn’t greet an email address by name', () => {
    expect(inviteMessage({ friend: 'meena@gmail.com', groups: [], link }).startsWith('Hi! ')).toBe(true);
  });
});
