import { describe, expect, it } from 'vitest';
import { pathFromState, stateFromPath } from './linking';

describe('screen addresses (Back button)', () => {
  const base = '/cosmic-balance/';
  it('Home is the bare address', () => {
    expect(pathFromState(base, { index: 0, routes: [{ name: 'Home' }] })).toBe(base);
    expect(stateFromPath(base)).toEqual({ routes: [{ name: 'Home' }] });
  });
  it('a screen goes in the query, with its params', () => {
    const path = pathFromState(base, { index: 1, routes: [{ name: 'Home' }, { name: 'Group', params: { groupId: 'g-1' } }] });
    expect(path).toBe('/cosmic-balance/?s=Group&groupId=g-1');
    expect(stateFromPath(path)).toEqual({ routes: [{ name: 'Home' }, { name: 'Group', params: { groupId: 'g-1' } }] });
  });
  it('different screens get different addresses, so Back finds the right one', () => {
    const a = pathFromState(base, { routes: [{ name: 'Home' }, { name: 'Group', params: { groupId: 'a' } }] });
    const b = pathFromState(base, { routes: [{ name: 'Home' }, { name: 'Group', params: { groupId: 'a' } }, { name: 'ExpenseForm', params: { groupId: 'a' } }] });
    expect(a).not.toBe(b);
  });
  it('numbers come back as numbers; empty params are left out', () => {
    const path = pathFromState(base, { routes: [{ name: 'SettleUp', params: { groupId: 'g', amount: 1250, from: undefined } }] });
    expect(path).toBe('/cosmic-balance/?s=SettleUp&groupId=g&amount=1250');
    expect(stateFromPath(path)?.routes[1].params).toEqual({ groupId: 'g', amount: 1250 });
  });
  it('sign-in and invite addresses and unknown screens are Home', () => {
    for (const p of ['/cosmic-balance/?code=abc', '/cosmic-balance/?join=XYZ', '/cosmic-balance/?s=Onboarding', '/cosmic-balance/?s=Nope']) {
      expect(stateFromPath(p)).toEqual({ routes: [{ name: 'Home' }] });
    }
  });
  it('screens without params', () => {
    expect(pathFromState(base, { routes: [{ name: 'Home' }, { name: 'Notifications' }] })).toBe('/cosmic-balance/?s=Notifications');
    expect(stateFromPath('/cosmic-balance/?s=Notifications')).toEqual({ routes: [{ name: 'Home' }, { name: 'Notifications', params: undefined }] });
  });
});
