import { describe, expect, it } from 'vitest';
import { filterFriends, matchesFriend } from './search';

const people = [
  { id: 'r', name: 'Ravi Kumar', email: 'ravi.k@gmail.com' },
  { id: 'p', name: 'Priya' },
  { id: 'k', name: 'Kiran' },
  { id: 'j', name: 'José', email: null },
];

describe('friend search', () => {
  it('matches any part of the name, ignoring case', () => {
    expect(matchesFriend(people[0], 'kum')).toBe(true);
    expect(matchesFriend(people[0], 'RAVI K')).toBe(true);
    expect(matchesFriend(people[1], 'ravi')).toBe(false);
  });
  it('ignores accents and spaces around', () => {
    expect(matchesFriend(people[3], ' jose ')).toBe(true);
  });
  it('matches the Gmail address too', () => {
    expect(matchesFriend(people[0], 'ravi.k@')).toBe(true);
  });
  it('shows everyone when nothing is typed', () => {
    expect(filterFriends(people, '   ')).toHaveLength(4);
  });
  it('keeps people already picked in view', () => {
    expect(filterFriends(people, 'kir', ['p']).map((p) => p.id)).toEqual(['p', 'k']);
  });
  it('can find nobody', () => {
    expect(filterFriends(people, 'zzz')).toEqual([]);
  });
});
