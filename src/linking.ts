// The phone's Back button: each screen gets its own entry in the browser's
// history, so Back goes to the previous screen instead of leaving the app.
//
// Screens are kept in the address as a query (…/cosmic-balance/?s=Group&groupId=…),
// never as a sub-path, so reloading any screen still loads the app (a static
// host like GitHub Pages only has the one page).
import type { RootStackParamList } from './navigation';

type Name = keyof RootStackParamList;

/** Screens that can be opened from an address. Home is the bare address. */
const SCREENS: Name[] = [
  'Group',
  'GroupSummary',
  'GroupForm',
  'ExpenseForm',
  'SettleUp',
  'Friend',
  'FriendForm',
  'Transfer',
  'SettleAll',
  'About',
  'Join',
  'Notifications',
];
const NUMBERS = new Set(['amount']);

export interface LinkState {
  routes: { name: Name; params?: Record<string, unknown> }[];
}

const HOME: LinkState = { routes: [{ name: 'Home' }] };

/**
 * The screen an address points at, on top of Home. Any other address (the
 * bare one, sign-in and invite links) is Home: so Back to an entry from
 * before a reload still finds its way home.
 */
export function stateFromPath(path: string): LinkState {
  let url: URL;
  try {
    url = new URL(path, 'http://app.invalid');
  } catch {
    return HOME;
  }
  const name = url.searchParams.get('s') as Name | null;
  if (!name || !SCREENS.includes(name)) return HOME;
  const params: Record<string, unknown> = {};
  url.searchParams.forEach((v, k) => {
    if (k !== 's') params[k] = NUMBERS.has(k) ? Number(v) : v;
  });
  return { routes: [{ name: 'Home' }, { name, params: Object.keys(params).length ? params : undefined }] };
}

/** The address for the screen on top of the stack. */
export function pathFromState(
  base: string,
  state: { index?: number; routes: { name: string; params?: object }[] } | undefined,
): string {
  const route = state?.routes[state.index ?? state.routes.length - 1];
  if (!route || !SCREENS.includes(route.name as Name)) return base;
  const q = new URLSearchParams({ s: route.name });
  for (const [k, v] of Object.entries(route.params ?? {})) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  return `${base}?${q.toString()}`;
}
