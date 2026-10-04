import { describe, expect, it } from 'vitest';
import { groupLinkMessage, inviteMessage } from './messages';

describe('invite messages', () => {
  const link = 'https://surya-vallala.github.io/cosmic-balance/?invite=abc123';
  it('greets the friend by first name and names the group', () => {
    expect(inviteMessage({ friend: 'Ravi Kumar', groups: ['Goa weekend'], link })).toBe(
      `Hi Ravi! I’ve added you to “Goa weekend” on Cosmic Balance, so we can split our expenses. Tap to join (sign in with Google): ${link}`,
    );
  });
  it('lists several groups', () => {
    expect(inviteMessage({ friend: 'Ravi', groups: ['Goa', 'Flat 302', 'Thailand'], link })).toContain(
      'to “Goa”, “Flat 302” and “Thailand” on Cosmic Balance',
    );
  });
  it('works for a friend outside groups', () => {
    expect(inviteMessage({ friend: 'Priya', groups: [], link })).toContain('as a friend on Cosmic Balance');
  });
  it('does not greet an email address as a name', () => {
    expect(inviteMessage({ friend: 'ravi@gmail.com', groups: [], link }).startsWith('Hi! ')).toBe(true);
  });
  it('the group link says they ask to join', () => {
    const m = groupLinkMessage({ group: 'Goa', link: 'https://x/?join=CODE' });
    expect(m).toContain('“Goa” on Cosmic Balance');
    expect(m).toContain('ask to join');
    expect(m.endsWith('https://x/?join=CODE')).toBe(true);
  });
});
