// Talking to Supabase: loading, writing, invites and live updates.
import { supabase } from './client';
import type { GroupRow, Op, PersonRow, Rows } from './sync';

const TABLES = ['people', 'groups', 'expenses', 'payments', 'transfers'] as const;

/**
 * A request that didn't work. `retry` is true when it's worth trying again
 * later unchanged (no connection, the server is busy or waking up, sign-in
 * being renewed); false when the database refused the change itself.
 */
export class CloudError extends Error {
  constructor(
    message: string,
    readonly retry = false,
    /** Postgres / PostgREST error code, when there was one. */
    readonly code?: string,
  ) {
    super(message);
  }
}

const NEEDS_DB_UPDATE =
  'This needs a one-time update to the shared database. Whoever set up Cosmic Khaata: in Supabase, run the latest supabase/schema.sql (see the README).';

interface ErrorLike {
  message?: string;
  code?: string;
}

const OFFLINE = "You're offline. Changes are saved on this phone and sent when you're back online.";

/** Turn a Supabase error into one people can act on. */
export function toCloudError(error: ErrorLike | null | undefined, status?: number): CloudError {
  const m = error?.message ?? '';
  if (status === 0 || /Failed to fetch|NetworkError|Network request failed|fetch failed|Load failed|ERR_INTERNET/i.test(m)) {
    return new CloudError(OFFLINE, true);
  }
  if ((status !== undefined && status >= 500) || status === 408 || status === 429) {
    return new CloudError('The server is busy. Your changes will be sent in a moment.', true);
  }
  if (status === 401 || /JWT|token/i.test(m)) {
    return new CloudError('Renewing your sign-in. Your changes will be sent in a moment.', true);
  }
  // A database function the app expects isn't there: the database is older than the app.
  if (error?.code === 'PGRST202') return new CloudError(NEEDS_DB_UPDATE, false, error.code);
  if (error?.code === '42501' || /row-level security|permission denied/i.test(m)) {
    return new CloudError("That change wasn't allowed. You may no longer be in this group, so it wasn't saved.", false, '42501');
  }
  if (error?.code === '23503') {
    return new CloudError("Someone removed something this change depends on, so it wasn't saved.", false, error.code);
  }
  return new CloudError(m || 'Something went wrong. Try again.', false, error?.code);
}

/** Everything the signed-in person is allowed to see. */
export async function fetchRows(): Promise<Rows> {
  let results;
  try {
    results = await Promise.all(TABLES.map((t) => supabase.from(t).select('*')));
  } catch (e) {
    throw toCloudError(e as ErrorLike, 0);
  }
  const out: Partial<Rows> = {};
  results.forEach((r, i) => {
    if (r.error) throw toCloudError(r.error, r.status);
    (out as Record<string, unknown>)[TABLES[i]] = r.data ?? [];
  });
  return out as Rows;
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  let res;
  try {
    res = await supabase.rpc(fn, args);
  } catch (e) {
    throw toCloudError(e as ErrorLike, 0);
  }
  if (res.error) throw toCloudError(res.error, res.status);
  return res.data as T;
}

/** Your own person row, created the first time you sign in. */
export function ensureMe(name: string): Promise<PersonRow> {
  return rpc<PersonRow>('ensure_me', { p_name: name });
}

/**
 * Write a list of changes in order. Stops at the first failure. Safe to
 * repeat after a lost connection: inserts that already happened are skipped.
 */
export async function applyOps(ops: Op[]): Promise<void> {
  for (const op of ops) {
    if (op.kind === 'rpc') {
      try {
        await rpc(op.fn, op.args);
      } catch (e) {
        // Database not updated yet (first version): change the member list the old way.
        if (e instanceof CloudError && e.code === 'PGRST202' && op.fn === 'set_group_members') {
          await setMembersTheOldWay(op.args as { p_group: string; p_add: string[]; p_remove: string[] });
        } else throw e;
      }
      continue;
    }
    const table = supabase.from(op.table);
    let res;
    try {
      if (op.kind === 'insert') res = await table.insert(op.values as never);
      else if (op.kind === 'upsert') res = await table.upsert(op.values as never);
      else if (op.kind === 'update') res = await table.update(op.values as never).eq('id', op.id).select('id');
      else res = await table.delete().eq('id', op.id).select('id');
    } catch (e) {
      throw toCloudError(e as ErrorLike, 0);
    }
    if (res.error) {
      // Already there: an earlier attempt got through before the connection dropped.
      if (op.kind === 'insert' && res.error.code === '23505') continue;
      throw toCloudError(res.error, res.status);
    }
    if (op.kind === 'update' && (!res.data || (res.data as unknown[]).length === 0)) throw new CloudError(op.failMessage);
    if (op.kind === 'delete' && (!res.data || (res.data as unknown[]).length === 0)) {
      // Nothing deleted: fine if it's already gone (an earlier attempt), refused if it's still there.
      const still = await supabase.from(op.table).select('id').eq('id', op.id);
      if (still.error) throw toCloudError(still.error, still.status);
      if (still.data && still.data.length > 0) throw new CloudError(op.failMessage);
    }
  }
}

/** For a database set up with the first version of schema.sql: apply the change to the list as it is now. */
async function setMembersTheOldWay({ p_group, p_add, p_remove }: { p_group: string; p_add: string[]; p_remove: string[] }) {
  const current = await supabase.from('groups').select('member_ids').eq('id', p_group).maybeSingle();
  if (current.error) throw toCloudError(current.error, current.status);
  if (!current.data) throw new CloudError("Couldn't save the group. You may no longer be a member.");
  const kept = (current.data.member_ids as string[]).filter((id) => !p_remove.includes(id));
  const member_ids = [...kept, ...p_add.filter((id) => !kept.includes(id))];
  const res = await supabase.from('groups').update({ member_ids } as never).eq('id', p_group).select('id');
  if (res.error) throw toCloudError(res.error, res.status);
  if (!res.data || res.data.length === 0) throw new CloudError("Couldn't save the group. You may no longer be a member.");
}

/** Add a friend by email: their account if they have one, else a placeholder that links when they sign in. */
export function addPersonByEmail(email: string, name?: string): Promise<PersonRow> {
  return rpc<PersonRow>('add_person_by_email', { p_email: email.trim(), p_name: name?.trim() || null });
}

/** Give a friend who hasn't joined an email (empty clears it). Returns the id they have now. */
export function setPersonEmail(personId: string, email: string): Promise<string> {
  return rpc<string>('set_person_email', { p_person: personId, p_email: email.trim() });
}

/** Personal invite codes for friends who haven't joined, by person id (made on first request). */
export async function personInviteCodes(personIds: string[]): Promise<Record<string, string>> {
  if (personIds.length === 0) return {};
  const rows = await rpc<{ person_id: string; code: string }[]>('person_invite_codes', { p_people: personIds });
  return Object.fromEntries((rows ?? []).map((r) => [r.person_id, r.code]));
}

export interface PersonInvitePreview {
  name: string;
  invited_by: string;
  mine: boolean;
  groups: string[];
}

export async function personInvitePreview(code: string): Promise<PersonInvitePreview | null> {
  return (await rpc<PersonInvitePreview | null>('person_invite_preview', { p_code: code })) ?? null;
}

/** Accept a personal invite. Returns the first group it puts you in, if any. */
export async function claimPersonInvite(code: string): Promise<string | null> {
  const res = await rpc<{ group_id: string | null }>('claim_person_invite', { p_code: code });
  return res?.group_id ?? null;
}

export interface GroupPreview {
  id: string;
  name: string;
  is_member: boolean;
  members: { id: string; name: string; claimed: boolean }[];
}

export async function groupPreview(code: string): Promise<GroupPreview | null> {
  return (await rpc<GroupPreview | null>('group_preview', { p_code: code })) ?? null;
}

export function joinGroup(code: string, claim: string | null): Promise<string> {
  return rpc<string>('join_group', { p_code: code, p_claim: claim });
}

export function resetInviteCode(groupId: string): Promise<string> {
  return rpc<string>('reset_invite_code', { p_group: groupId });
}

/** Call `onChange` whenever anything you can see changes. Returns a stop function. */
export function subscribe(onChange: () => void): () => void {
  let channel = supabase.channel('cosmic-khaata-changes');
  for (const t of TABLES) {
    channel = channel.on('postgres_changes' as never, { event: '*', schema: 'public', table: t } as never, onChange);
  }
  // Coming back after the connection dropped: catch up on anything missed.
  channel.subscribe((status: string) => {
    if (status === 'SUBSCRIBED') onChange();
  });
  return () => {
    supabase.removeChannel(channel);
  };
}

export type { GroupRow };
