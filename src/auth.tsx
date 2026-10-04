// Who is using the app, and how: signed in (shared data), on this phone only
// (local data), or not decided yet (welcome screen).
// (Storage keys keep the app's earlier name so nothing saved on phones is lost.)
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { supabase } from './cloud/client';
import { turnOffPush } from './push';

const MODE_KEY = 'cosmic-khaata:mode';
const PENDING_JOIN_KEY = 'cosmic-khaata:pending-join';
const PENDING_INVITE_KEY = 'cosmic-khaata:pending-invite';
const PENDING_FRIEND_KEY = 'cosmic-khaata:pending-friend';

export type Mode = 'loading' | 'welcome' | 'local' | 'cloud';

interface Auth {
  mode: Mode;
  session: Session | null;
  /** Group invite code from a link that hasn't been used yet. */
  pendingJoin: string | null;
  clearPendingJoin: () => void;
  /** Personal invite code (sent to one friend on WhatsApp) that hasn't been used yet. */
  pendingInvite: string | null;
  clearPendingInvite: () => void;
  /** Friend link code (someone's ?friend= link) that hasn't been used yet. */
  pendingFriend: string | null;
  clearPendingFriend: () => void;
  authError: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  chooseThisPhoneOnly: () => void;
  backToWelcome: () => void;
}

const AuthContext = createContext<Auth | null>(null);

/**
 * Read ?join=CODE (group invite), ?invite=CODE (personal invite) and sign-in
 * errors from the address, then tidy it.
 */
function readUrl(): { join: string | null; invite: string | null; friend: string | null; error: string | null } {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return { join: null, invite: null, friend: null, error: null };
  const url = new URL(window.location.href);
  const join = url.searchParams.get('join');
  const invite = url.searchParams.get('invite');
  const friend = url.searchParams.get('friend');
  const error = url.searchParams.get('error_description') || url.hash.match(/error_description=([^&]+)/)?.[1] || null;
  if (join || invite || friend) {
    url.searchParams.delete('join');
    url.searchParams.delete('invite');
    url.searchParams.delete('friend');
    window.history.replaceState(null, '', url.pathname + (url.search === '?' ? '' : url.search) + url.hash);
  }
  return { join, invite, friend, error: error ? decodeURIComponent(error.replace(/\+/g, ' ')) : null };
}

// Read once, when the app loads: the address is tidied straight after.
const initialUrl = readUrl();

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [localChosen, setLocalChosen] = useState<boolean | null>(null);
  const [pendingJoin, setPendingJoin] = useState<string | null>(null);
  const [pendingInvite, setPendingInvite] = useState<string | null>(null);
  const [pendingFriend, setPendingFriend] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(initialUrl.error);

  useEffect(() => {
    const { join, invite, friend } = initialUrl;
    (async () => {
      try {
        // Kept on the phone so the invite survives the trip to Google and back.
        if (join) {
          await AsyncStorage.setItem(PENDING_JOIN_KEY, join);
          setPendingJoin(join);
        } else {
          setPendingJoin(await AsyncStorage.getItem(PENDING_JOIN_KEY));
        }
        if (invite) {
          await AsyncStorage.setItem(PENDING_INVITE_KEY, invite);
          setPendingInvite(invite);
        } else {
          setPendingInvite(await AsyncStorage.getItem(PENDING_INVITE_KEY));
        }
        if (friend) {
          await AsyncStorage.setItem(PENDING_FRIEND_KEY, friend);
          setPendingFriend(friend);
        } else {
          setPendingFriend(await AsyncStorage.getItem(PENDING_FRIEND_KEY));
        }
        setLocalChosen((await AsyncStorage.getItem(MODE_KEY)) === 'local');
      } catch {
        setLocalChosen(false);
      }
    })();

    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session))
      .catch(() => {})
      .finally(() => setSessionChecked(true));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);
    if (Platform.OS !== 'web') {
      setAuthError('Sign in from the web app for now: open it in your browser and add it to your home screen.');
      return;
    }
    const redirectTo = window.location.origin + window.location.pathname;
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
    if (error) setAuthError(error.message);
  }, []);

  const signOut = useCallback(async () => {
    const id = session?.user.id;
    // This phone stops getting this account's notifications.
    await turnOffPush().catch(() => {});
    await supabase.auth.signOut().catch(() => {});
    // Forget this account's copy of the shared data on this phone. Changes not
    // sent yet are kept, and go out the next time this account signs in here.
    if (id) AsyncStorage.removeItem(`cosmic-khaata:cloud:${id}`).catch(() => {});
    setSession(null);
  }, [session]);

  const chooseThisPhoneOnly = useCallback(() => {
    AsyncStorage.setItem(MODE_KEY, 'local').catch(() => {});
    setLocalChosen(true);
  }, []);

  const backToWelcome = useCallback(() => {
    AsyncStorage.removeItem(MODE_KEY).catch(() => {});
    setLocalChosen(false);
  }, []);

  const clearPendingJoin = useCallback(() => {
    AsyncStorage.removeItem(PENDING_JOIN_KEY).catch(() => {});
    setPendingJoin(null);
  }, []);

  const clearPendingInvite = useCallback(() => {
    AsyncStorage.removeItem(PENDING_INVITE_KEY).catch(() => {});
    setPendingInvite(null);
  }, []);

  const clearPendingFriend = useCallback(() => {
    AsyncStorage.removeItem(PENDING_FRIEND_KEY).catch(() => {});
    setPendingFriend(null);
  }, []);

  const mode: Mode = !sessionChecked || localChosen === null ? 'loading' : session ? 'cloud' : localChosen ? 'local' : 'welcome';

  const value = useMemo(
    () => ({
      mode,
      session,
      pendingJoin,
      clearPendingJoin,
      pendingInvite,
      clearPendingInvite,
      pendingFriend,
      clearPendingFriend,
      authError,
      signInWithGoogle,
      signOut,
      chooseThisPhoneOnly,
      backToWelcome,
    }),
    [
      mode,
      session,
      pendingJoin,
      clearPendingJoin,
      pendingInvite,
      clearPendingInvite,
      pendingFriend,
      clearPendingFriend,
      authError,
      signInWithGoogle,
      signOut,
      chooseThisPhoneOnly,
      backToWelcome,
    ],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const a = useContext(AuthContext);
  if (!a) throw new Error('useAuth must be used inside AuthProvider');
  return a;
}
