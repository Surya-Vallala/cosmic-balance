// Profile pictures: who has one, shared with every Avatar on screen.
import { createContext } from 'react';
import type { Id, Photo } from './types';

/** Person id → their picture. Provided by the store; empty outside it. */
export const PhotoContext = createContext<Record<Id, Photo>>({});

/**
 * Bring the pictures we have up to date with what the server lists
 * (person id and when each was last set): keep the ones that haven't
 * changed, fetch the rest, and forget the ones that are gone.
 */
export async function syncPhotos(
  stamps: { person_id: string; updated_at: string }[] | undefined,
  cached: Record<Id, Photo> = {},
  fetch: (ids: Id[]) => Promise<{ person_id: string; image: string; updated_at: string }[]>,
): Promise<Record<Id, Photo>> {
  if (!stamps) return cached; // an older database without pictures
  const out: Record<Id, Photo> = {};
  const need: Id[] = [];
  for (const s of stamps) {
    const have = cached[s.person_id];
    if (have && have.at === s.updated_at) out[s.person_id] = have;
    else need.push(s.person_id);
  }
  if (need.length) {
    try {
      for (const r of await fetch(need)) out[r.person_id] = { image: r.image, at: r.updated_at };
    } catch {
      // No connection right now: keep showing the old picture until next time.
      for (const id of need) if (cached[id]) out[id] = cached[id];
    }
  }
  return out;
}
