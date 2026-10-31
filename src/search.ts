// Finding friends by typing part of their name (or Gmail, in shared mode).

/** Lower case and without accents, so "jose" finds "José". */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Whether a person matches what was typed: any part of the name or email. Nothing typed matches everyone. */
export function matchesFriend(p: { name: string; email?: string | null }, query: string): boolean {
  const q = fold(query);
  if (!q) return true;
  return fold(p.name).includes(q) || (!!p.email && fold(p.email).includes(q));
}

/** The people to show for a search: the matches, plus anyone already picked, so picks stay in view. */
export function filterFriends<T extends { id: string; name: string; email?: string | null }>(
  list: T[],
  query: string,
  keep: string[] = [],
): T[] {
  return list.filter((p) => keep.includes(p.id) || matchesFriend(p, query));
}

/** Show a search box once a list is long enough to need one. */
export const SEARCH_FROM = 3;

/** Your friend with exactly this name (ignoring case and extra spaces), if you have one. */
export function friendNamed<T extends { id: string; name: string; requesting?: boolean }>(
  people: Record<string, T>,
  meId: string | null,
  name: string,
): T | undefined {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const n = norm(name);
  if (!n) return undefined;
  return Object.values(people).find((p) => p.id !== meId && !p.requesting && norm(p.name) === n);
}
