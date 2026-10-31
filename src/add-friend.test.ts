import { describe, expect, it } from 'vitest';
import { friendNamed } from './search';

describe('adding a friend while recording', () => {
  const people = {
    me: { id: 'me', name: 'Surya' },
    d: { id: 'd', name: 'Deepak  Rao' },
    r: { id: 'r', name: 'Ravi', requesting: true },
  };
  it('finds a friend already added under that name, however it is typed', () => {
    expect(friendNamed(people, 'me', ' deepak rao ')?.id).toBe('d');
    expect(friendNamed(people, 'me', 'Deepak')).toBeUndefined();
  });
  it('never matches you, or someone who only asked to join', () => {
    expect(friendNamed(people, 'me', 'Surya')).toBeUndefined();
    expect(friendNamed(people, 'me', 'Ravi')).toBeUndefined();
    expect(friendNamed(people, 'me', '  ')).toBeUndefined();
  });
});
