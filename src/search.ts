// Finding friends by typing part of their name (or Gmail, in shared mode).

/** Lower case and without accents, so "jose" finds "José". */
function fold(s: string): string {
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
