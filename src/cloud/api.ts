// Talking to Supabase: loading, writing, invites and live updates.
import { supabase } from './client';
import type { GroupRow, Op, PersonRow, Rows } from './sync';

const TABLES = ['people', 'groups', 'expenses', 'payments', 'transfers'] as const;

export class CloudError extends Error {}

function friendly(message: string | undefined): string {
  const m = message ?? '';
  if (/fetch|network|Failed to fetch|NetworkError/i.test(m)) return "You're offline. Check your connection and try again.";
  if (/JWT|token/i.test(m)) return 'Your sign-in has expired. Sign in again.';
  return m || 'Something went wrong. Try again.';
}

/** Everything the signed-in person is allowed to see. */
export async function fetchRows(): Promise<Rows> {
  const results = await Promise.all(TABLES.map((t) => supabase.from(t).select('*')));
  const out: Partial<Rows> = {};
  results.forEach((r, i) => {
    if (r.error) throw new CloudError(friendly(r.error.message));
    (out as Record<string, unknown>)[TABLES[i]] = r.data ?? [];
  });
  return out as Rows;
}

/** Your own person row, created the first time you sign in. */
export async function ensureMe(name: string): Promise<PersonRow> {
  const { data, error } = await supabase.rpc('ensure_me', { p_name: name });
  if (error) throw new CloudError(friendly(error.message));
  return data as PersonRow;
}

/** Write a list of changes in order. Stops at the first failure. */
export async function applyOps(ops: Op[]): Promise<void> {
  for (const op of ops) {
    const table = supabase.from(op.table);
    if (op.kind === 'insert') {
      const { error } = await table.insert(op.values as never);
      if (error) throw new CloudError(friendly(error.message));
    } else if (op.kind === 'upsert') {
      const { error } = await table.upsert(op.values as never);
      if (error) throw new CloudError(friendly(error.message));
    } else if (op.kind === 'update') {
      const { data, error } = await table.update(op.values as never).eq('id', op.id).select('id');
      if (error) throw new CloudError(friendly(error.message));
      if (!data || data.length === 0) throw new CloudError(op.failMessage);
    } else if (op.kind === 'delete') {
      const { data, error } = await table.delete().eq('id', op.id).select('id');
      if (error) throw new CloudError(friendly(error.message));
      if (!data || data.length === 0) throw new CloudError(op.failMessage);
    }
  }
}

export interface GroupPreview {
  id: string;
  name: string;
  is_member: boolean;
  members: { id: string; name: string; claimed: boolean }[];
}

export async function groupPreview(code: string): Promise<GroupPreview | null> {
  const { data, error } = await supabase.rpc('group_preview', { p_code: code });
  if (error) throw new CloudError(friendly(error.message));
  return (data as GroupPreview | null) ?? null;
}

export async function joinGroup(code: string, claim: string | null): Promise<string> {
  const { data, error } = await supabase.rpc('join_group', { p_code: code, p_claim: claim });
  if (error) throw new CloudError(friendly(error.message));
  return data as string;
}

export async function resetInviteCode(groupId: string): Promise<string> {
  const { data, error } = await supabase.rpc('reset_invite_code', { p_group: groupId });
  if (error) throw new CloudError(friendly(error.message));
  return data as string;
}

/** Call `onChange` whenever anything you can see changes. Returns a stop function. */
export function subscribe(onChange: () => void): () => void {
  let channel = supabase.channel('cosmic-khaata-changes');
  for (const t of TABLES) {
    channel = channel.on('postgres_changes' as never, { event: '*', schema: 'public', table: t } as never, onChange);
  }
  channel.subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

export type { GroupRow };
