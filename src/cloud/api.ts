// Talking to Supabase: loading, writing, invites, notifications and live updates.
import { supabase } from './client';
import type { GroupRow, Op, PersonRow, Rows } from './sync';

const TABLES = ['people', 'groups', 'expenses', 'payments', 'transfers'] as const;
/** Tables added later: an older database simply doesn't have them yet. */
const OPTIONAL_TABLES = ['notifications', 'join_requests', 'contacts', 'friend_requests'] as const;

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
  'This needs a one-time update to the shared database. Whoever set up Cosmic Balance: in Supabase, run the latest supabase/schema.sql (see the README).';

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

const MISSING_TABLE = new Set(['PGRST205', '42P01', 'PGRST106']);

/** Everything the signed-in person is allowed to see. */
export async function fetchRows(): Promise<Rows> {
  let results;
  let extra;
  try {
    [results, extra] = await Promise.all([
      Promise.all(TABLES.map((t) => supabase.from(t).select('*'))),
      Promise.all([
        supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(100),
        supabase.from('join_requests').select('*'),
        supabase.from('contacts').select('person_id'),
        supabase.from('friend_requests').select('*'),
      ]),
    ]);
  } catch (e) {
    throw toCloudError(e as ErrorLike, 0);
  }
  const out: Partial<Rows> = {};
  results.forEach((r, i) => {
    if (r.error) throw toCloudError(r.error, r.status);
    (out as Record<string, unknown>)[TABLES[i]] = r.data ?? [];
  });
  extra.forEach((r, i) => {
    if (r.error && !MISSING_TABLE.has(r.error.code ?? '') && r.status !== 404) throw toCloudError(r.error, r.status);
    (out as Record<string, unknown>)[OPTIONAL_TABLES[i]] = r.error ? [] : r.data ?? [];
  });
  return out as Rows;
}

/** Functions that may tell someone something: afterwards, ask for delivery to phones. */
const NOTIFYING = new Set([
  'ensure_me',
  'set_group_members',
  'claim_person_invite',
  'request_join',
  'approve_join_request',
  'request_friend',
  'approve_friend_request',
]);

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  let res;
  try {
    res = await supabase.rpc(fn, args);
  } catch (e) {
    throw toCloudError(e as ErrorLike, 0);
  }
  if (res.error) throw toCloudError(res.error, res.status);
  if (NOTIFYING.has(fn)) kickPush();
  return res.data as T;
}

// ---------------------------------------------------------------------------
// Notifications

let kickTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Ask the send-push function to deliver new notifications to phones. The
 * database asks too; this is the backup. Harmless if there's nothing to send
 * or the function isn't set up.
 */
export function kickPush(): void {
  if (kickTimer) clearTimeout(kickTimer);
  kickTimer = setTimeout(() => {
    kickTimer = null;
    supabase.functions.invoke('send-push', { body: {} }).catch(() => {});
  }, 1500);
}

export function markNotificationsRead(): Promise<void> {
  return rpc<void>('mark_notifications_read', {});
}

export function pushPublicKey(): Promise<string | null> {
  return rpc<string | null>('push_public_key', {});
}

export function savePushSubscription(endpoint: string, p256dh: string, auth: string): Promise<void> {
  return rpc<void>('save_push_subscription', { p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth });
}

export function deletePushSubscription(endpoint: string): Promise<void> {
  return rpc<void>('delete_push_subscription', { p_endpoint: endpoint });
}

/** Make the send-push function run now (it creates the push keys on its first run). */
export async function runSendPush(): Promise<void> {
  await supabase.functions.invoke('send-push', { body: {} });
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
    kickPush();
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
  /** You've asked to join and are waiting. */
  requested?: boolean;
  /** Who lets people in. */
  owner?: string;
  member_count?: number;
}

export async function groupPreview(code: string): Promise<GroupPreview | null> {
  return (await rpc<GroupPreview | null>('group_preview', { p_code: code })) ?? null;
}

/** Ask to join a group from its link. */
export function requestJoin(code: string): Promise<{ group_id: string; status: 'member' | 'requested' }> {
  return rpc('request_join', { p_code: code });
}

/** Let someone in, as a new member or as `as` (the name added for them). */
export function approveJoinRequest(requestId: string, as: string | null): Promise<string> {
  return rpc<string>('approve_join_request', { p_request: requestId, p_as: as });
}

export function declineJoinRequest(requestId: string): Promise<void> {
  return rpc<void>('decline_join_request', { p_request: requestId });
}

// Friend links ------------------------------------------------------------------

/** Your friend link's code. */
export function myFriendCode(): Promise<string> {
  return rpc<string>('my_friend_code', {});
}

/** A new code: the old link stops working. */
export function resetFriendCode(): Promise<string> {
  return rpc<string>('reset_friend_code', {});
}

export interface FriendLinkPreview {
  name: string;
  mine: boolean;
  friends: boolean;
  requested: boolean;
}

export async function friendLinkPreview(code: string): Promise<FriendLinkPreview | null> {
  return (await rpc<FriendLinkPreview | null>('friend_link_preview', { p_code: code })) ?? null;
}

/** Ask to be friends with whoever's link this is. */
export function requestFriend(code: string): Promise<{ status: 'requested' | 'friends' }> {
  return rpc('request_friend', { p_code: code });
}

export function approveFriendRequest(requestId: string): Promise<string> {
  return rpc<string>('approve_friend_request', { p_request: requestId });
}

export function declineFriendRequest(requestId: string): Promise<void> {
  return rpc<void>('decline_friend_request', { p_request: requestId });
}

export function resetInviteCode(groupId: string): Promise<string> {
  return rpc<string>('reset_invite_code', { p_group: groupId });
}

/** Call `onChange` whenever anything you can see changes. Returns a stop function. */
export function subscribe(onChange: () => void): () => void {
  let channel = supabase.channel('cosmic-balance-changes');
  for (const t of [...TABLES, 'join_requests', 'notifications', 'friend_requests']) {
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
