// Where the shared database lives. The publishable key is meant to be in the
// app: what each signed-in person can read or change is decided by the row
// level security rules in supabase/schema.sql.
//
// For local testing the build can point elsewhere with
// EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_KEY / EXPO_PUBLIC_APP_URL.

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://jwmnmrmocilfrqohhezf.supabase.co';
export const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_KEY || 'sb_publishable_f7rutcv_lapGxGvHdeYepg_Y84ugfwH';

/** The public address of the installable web app (used for invite links and sign-in). */
export const APP_URL = process.env.EXPO_PUBLIC_APP_URL || 'https://surya-vallala.github.io/cosmic-balance/';

export function inviteLink(code: string): string {
  return `${APP_URL}?join=${encodeURIComponent(code)}`;
}

/** A friend's personal invite: opening it and signing in makes them that person. */
export function personInviteLink(code: string): string {
  return `${APP_URL}?invite=${encodeURIComponent(code)}`;
}
