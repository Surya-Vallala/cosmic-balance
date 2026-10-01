import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, AppState as RNAppState } from 'react-native';
import {
  addPersonByEmail as apiAddPersonByEmail,
  applyOps,
  CloudError,
  ensureMe,
  fetchRows,
  setPersonEmail as apiSetPersonEmail,
  subscribe,
} from './cloud/api';
import { actionToOps, personFromRow, rowsToState, type Op } from './cloud/sync';
import { formatMoney } from './money';
import type { Activity, AppState, Expense, Group, Id, Payment, Person, Transfer } from './types';

const STORAGE_KEY = 'cosmic-khaata:v1';
// Data saved under the app's earlier names; read once and carried over.
const LEGACY_STORAGE_KEYS = ['cosmic-split:v1', 'hisaab:v1'];

/** A new random id (UUID v4), the format the shared database expects. */
export const uid = (): string => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
};
const now = () => new Date().toISOString();

export const emptyState: AppState = {
  version: 1,
  meId: null,
  people: {},
  groups: [],
  expenses: [],
  payments: [],
  transfers: [],
  activity: [],
};

export type Action =
  | { type: 'hydrate'; state: AppState }
  | { type: 'setup'; me: Person }
  | { type: 'loadSample' }
  | { type: 'savePerson'; person: Person }
  | { type: 'saveGroup'; group: Group }
  | { type: 'deleteGroup'; id: Id }
  | { type: 'leaveGroup'; id: Id }
  | { type: 'saveExpense'; expense: Expense }
  | { type: 'deleteExpense'; id: Id }
  | { type: 'addPayment'; payment: Payment }
  | { type: 'deletePayment'; id: Id }
  | { type: 'saveTransfer'; transfer: Transfer }
  | { type: 'deleteTransfer'; id: Id }
  | { type: 'settleOverall'; settlement: Transfer; payments: Payment[] }
  | { type: 'reset' };

function nameOf(s: AppState, id: Id) {
  if (id === s.meId) return 'You';
  return s.people[id]?.name ?? 'Someone';
}

function log(s: AppState, text: string, groupId?: Id): Activity[] {
  return [{ id: uid(), at: now(), groupId, text }, ...s.activity].slice(0, 300);
}

function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'hydrate':
      return a.state;
    case 'setup':
      return { ...s, meId: a.me.id, people: { ...s.people, [a.me.id]: a.me } };
    case 'loadSample':
      return s.meId ? sampleData(s) : s;
    case 'savePerson': {
      const isNew = !s.people[a.person.id];
      const next = { ...s, people: { ...s.people, [a.person.id]: a.person } };
      return isNew ? { ...next, activity: log(s, `You added ${a.person.name} as a friend`) } : next;
    }
    case 'saveGroup': {
      const exists = s.groups.some((g) => g.id === a.group.id);
      const groups = exists ? s.groups.map((g) => (g.id === a.group.id ? a.group : g)) : [a.group, ...s.groups];
      const text = exists ? `You updated ${a.group.name}` : `You created ${a.group.name}`;
      return { ...s, groups, activity: log(s, text, a.group.id) };
    }
    case 'deleteGroup': {
      const g = s.groups.find((x) => x.id === a.id);
      return {
        ...s,
        groups: s.groups.filter((x) => x.id !== a.id),
        expenses: s.expenses.filter((e) => e.groupId !== a.id),
        payments: s.payments.filter((p) => p.groupId !== a.id),
        activity: log(s, `You deleted ${g?.name ?? 'a group'}`),
      };
    }
    case 'leaveGroup': {
      const g = s.groups.find((x) => x.id === a.id);
      return {
        ...s,
        groups: s.groups.filter((x) => x.id !== a.id),
        expenses: s.expenses.filter((e) => e.groupId !== a.id),
        payments: s.payments.filter((p) => p.groupId !== a.id),
        activity: log(s, `You left ${g?.name ?? 'a group'}`),
      };
    }
    case 'saveExpense': {
      const e = a.expense;
      const exists = s.expenses.some((x) => x.id === e.id);
      const expenses = exists ? s.expenses.map((x) => (x.id === e.id ? e : x)) : [e, ...s.expenses];
      const g = s.groups.find((x) => x.id === e.groupId);
      const verb = exists ? 'edited' : 'added';
      return {
        ...s,
        expenses,
        activity: log(
          s,
          `You ${verb} “${e.description}” (${formatMoney(e.amount, e.currency)}) in ${g?.name ?? 'a group'}`,
          e.groupId,
        ),
      };
    }
    case 'deleteExpense': {
      const e = s.expenses.find((x) => x.id === a.id);
      if (!e) return s;
      const g = s.groups.find((x) => x.id === e.groupId);
      return {
        ...s,
        expenses: s.expenses.filter((x) => x.id !== a.id),
        activity: log(s, `You deleted “${e.description}” from ${g?.name ?? 'a group'}`, e.groupId),
      };
    }
    case 'addPayment': {
      const p = a.payment;
      const g = s.groups.find((x) => x.id === p.groupId);
      const from = nameOf(s, p.from);
      const to = p.to === s.meId ? 'you' : nameOf(s, p.to);
      return {
        ...s,
        payments: [p, ...s.payments.filter((x) => x.id !== p.id)],
        activity: log(s, `${from} paid ${to} ${formatMoney(p.amount, p.currency)} in ${g?.name ?? 'a group'}`, p.groupId),
      };
    }
    case 'deletePayment': {
      const p = s.payments.find((x) => x.id === a.id);
      if (!p) return s;
      return {
        ...s,
        payments: s.payments.filter((x) => x.id !== a.id),
        activity: log(s, `You deleted a payment of ${formatMoney(p.amount, p.currency)}`, p.groupId),
      };
    }
    case 'saveTransfer': {
      const t = a.transfer;
      const exists = s.transfers.some((x) => x.id === t.id);
      const transfers = exists ? s.transfers.map((x) => (x.id === t.id ? t : x)) : [t, ...s.transfers];
      const to = t.to === s.meId ? 'you' : nameOf(s, t.to);
      const note = t.note ? ` (${t.note})` : '';
      const verb = exists ? 'edited a transfer' : 'gave';
      const text = exists
        ? `You edited a transfer: ${nameOf(s, t.from)} to ${to}, ${formatMoney(t.amount, t.currency)}`
        : `${nameOf(s, t.from)} ${verb} ${to} ${formatMoney(t.amount, t.currency)}${note}`;
      return { ...s, transfers, activity: log(s, text) };
    }
    case 'deleteTransfer': {
      const t = s.transfers.find((x) => x.id === a.id);
      if (!t) return s;
      const what = t.kind === 'settlement' ? 'an overall settle-up' : 'a transfer';
      return {
        ...s,
        transfers: s.transfers.filter((x) => x.id !== a.id),
        // An overall settle-up also wrote balancing payments into groups.
        payments: s.payments.filter((p) => p.settlementId !== a.id),
        activity: log(s, `You deleted ${what} of ${formatMoney(t.amount, t.currency)}`),
      };
    }
    case 'settleOverall': {
      const t = a.settlement;
      const to = t.to === s.meId ? 'you' : nameOf(s, t.to);
      const groupsCleared = new Set(a.payments.map((p) => p.groupId)).size;
      const where = groupsCleared ? `, clearing ${groupsCleared} group${groupsCleared === 1 ? '' : 's'}` : '';
      const ids = new Set(a.payments.map((p) => p.id));
      return {
        ...s,
        transfers: [t, ...s.transfers.filter((x) => x.id !== t.id)],
        payments: [...a.payments, ...s.payments.filter((p) => !ids.has(p.id))],
        activity: log(s, `${nameOf(s, t.from)} settled up with ${to}: ${formatMoney(t.amount, t.currency)}${where}`),
      };
    }
    case 'reset':
      return emptyState;
  }
}

interface Store {
  state: AppState;
  dispatch: (action: Action) => void;
  ready: boolean;
  /** 'local': data on this phone only. 'cloud': shared, signed in. */
  mode: 'local' | 'cloud';
  /** Signed-in account (shared mode). */
  userId: string | null;
  email: string | null;
  /** Reload everything from the shared database. */
  refresh: () => Promise<void>;
  /** A change the database refused, shown to the user. */
  syncError: string | null;
  clearSyncError: () => void;
  /** Couldn't load shared data at all (and nothing cached). */
  loadError: string | null;
  /** Changes made on this phone that haven't reached the database yet. */
  unsaved: number;
  /** The last attempt to reach the database failed for lack of a connection. */
  offline: boolean;
  /** Shared mode: add a friend by email (their account, or a placeholder that links when they sign in). */
  addPersonByEmail: (email: string, name?: string) => Promise<Person>;
  /** Shared mode: give a friend who hasn't joined an email. Returns the id they have afterwards. */
  setPersonEmail: (personId: Id, email: string) => Promise<Id>;
}

const StoreContext = createContext<Store | null>(null);

/** A change waiting to be written to the shared database, in order. */
interface PendingWrite {
  id: string;
  action: Action;
  ops: Op[];
}

/** Apply changes still on their way to the database on top of fresh data. */
function withPending(fresh: AppState, pending: PendingWrite[]): AppState {
  // The activity feed in shared mode comes from the database, so leave it as fetched.
  return pending.reduce((s, p) => ({ ...reducer(s, p.action), activity: s.activity }), fresh);
}

/**
 * Bring data saved by older versions of the app up to date:
 * - expenses used to have a single `paidBy` person; they now record what
 *   each payer paid;
 * - everything was in rupees; groups, expenses and payments now carry a
 *   currency.
 */
function migrate(saved: AppState): AppState {
  const groups = (saved.groups ?? []).map((g) => ({
    ...g,
    baseCurrency: g.baseCurrency ?? 'INR',
    rates: g.rates ?? {},
  }));
  const baseOf = (groupId: Id) => groups.find((g) => g.id === groupId)?.baseCurrency ?? 'INR';
  return {
    ...saved,
    groups,
    expenses: (saved.expenses ?? []).map((e) => {
      const legacy = e as Expense & { paidBy?: Id };
      const { paidBy, ...rest } = legacy;
      return {
        ...rest,
        currency: legacy.currency ?? baseOf(e.groupId),
        payers: legacy.payers ?? (paidBy ? { [paidBy]: legacy.amount } : {}),
      };
    }),
    payments: (saved.payments ?? []).map((p) => ({
      ...p,
      currency: p.currency ?? baseOf(p.groupId),
      baseAmount: p.baseAmount ?? p.amount,
    })),
    transfers: saved.transfers ?? [],
  };
}

function displayName(session: Session): string {
  const m = session.user.user_metadata ?? {};
  return (m.full_name || m.name || session.user.email?.split('@')[0] || 'Me') as string;
}

export function StoreProvider({
  mode,
  session,
  children,
}: {
  mode: 'local' | 'cloud';
  session: Session | null;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<AppState>(emptyState);
  const stateRef = useRef<AppState>(emptyState);
  const [ready, setReady] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [unsaved, setUnsaved] = useState(0);
  const [offline, setOffline] = useState(false);
  const offlineRef = useRef(false);
  useEffect(() => {
    offlineRef.current = offline;
  }, [offline]);
  const loaded = useRef(false);
  const userId = mode === 'cloud' ? session?.user.id ?? null : null;
  const storageKey = mode === 'cloud' ? `cosmic-khaata:cloud:${userId}` : STORAGE_KEY;
  const pendingKey = `${storageKey}:pending`;

  const replaceState = useCallback((next: AppState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  // ---- Shared mode: changes on their way to the database ------------------------
  // Each change shows at once and joins a queue saved on the phone. The queue
  // is written in order; without a connection it waits and tries again, so
  // nothing is lost when the signal drops or the app is closed. A change the
  // database refuses is dropped and the reason shown.
  const pending = useRef<PendingWrite[]>([]);
  const writesDone = useRef(0); // to spot a fetch that raced with a write
  const flushing = useRef(false);
  const alive = useRef(true);
  const wakeFlusher = useRef<(() => void) | null>(null);
  const idleWaiters = useRef<(() => void)[]>([]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      wakeFlusher.current?.();
    };
  }, []);

  const savePending = useCallback(() => {
    setUnsaved(pending.current.length);
    AsyncStorage.setItem(pendingKey, JSON.stringify(pending.current)).catch(() => {});
  }, [pendingKey]);

  // ---- Shared mode: fetching ---------------------------------------------------
  // The provider is remounted (keyed by mode and user) when either changes, so
  // everything here starts fresh for each account.
  const meIdRef = useRef<string | null>(null);
  const fetchSeq = useRef(0);
  const refresh = useCallback(async () => {
    if (mode !== 'cloud' || !session) return;
    const seq = ++fetchSeq.current;
    try {
      if (!meIdRef.current) meIdRef.current = (await ensureMe(displayName(session))).id;
      for (let attempt = 0; ; attempt++) {
        const writesBefore = writesDone.current;
        const rows = await fetchRows();
        if (seq !== fetchSeq.current) return; // a newer fetch is on its way
        // If a write landed while fetching, this copy may be missing it: fetch again.
        if (writesDone.current !== writesBefore && attempt < 2) continue;
        replaceState(withPending(rowsToState(rows, meIdRef.current), pending.current));
        break;
      }
      setLoadError(null);
      setOffline(false);
      wakeFlusher.current?.(); // we're online: send anything waiting now
    } catch (e) {
      const err = e instanceof CloudError ? e : new CloudError(String(e));
      if (!stateRef.current.meId) setLoadError(err.message);
      else if (err.retry) setOffline(true);
      else setSyncError(err.message);
    }
  }, [mode, session, replaceState]);
  // Timers and listeners call the latest refresh (the session object changes when tokens renew).
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  // Refetch soon after changes; many changes in a burst cause one refetch.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => refreshRef.current(), 500);
  }, []);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const flush = useCallback(async () => {
    if (flushing.current || mode !== 'cloud') return;
    flushing.current = true;
    let delay = 2000;
    try {
      while (alive.current && pending.current.length > 0) {
        const item = pending.current[0];
        try {
          await applyOps(item.ops);
        } catch (e) {
          const err = e instanceof CloudError ? e : new CloudError(String(e));
          if (err.retry) {
            setOffline(true);
            // Wait, then try again; coming back online or a new change wakes it sooner.
            await new Promise<void>((resolve) => {
              const t = setTimeout(done, delay);
              function done() {
                clearTimeout(t);
                wakeFlusher.current = null;
                resolve();
              }
              wakeFlusher.current = done;
            });
            delay = Math.min(delay * 2, 30000);
            continue;
          }
          setSyncError(err.message);
        }
        pending.current = pending.current.filter((p) => p.id !== item.id);
        writesDone.current += 1;
        delay = 2000;
        setOffline(false);
        savePending();
      }
    } finally {
      flushing.current = false;
    }
    if (!alive.current) return;
    if (pending.current.length === 0) {
      idleWaiters.current.splice(0).forEach((resolve) => resolve());
    }
    scheduleRefresh();
  }, [mode, savePending, scheduleRefresh]);

  /** Resolves once everything queued so far has reached the database (or after a while). */
  const whenSaved = useCallback(
    () =>
      pending.current.length === 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            idleWaiters.current.push(resolve);
            setTimeout(resolve, 15000);
          }),
    [],
  );

  // ---- Loading -------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let raw = await AsyncStorage.getItem(storageKey);
        if (mode === 'local') for (const key of LEGACY_STORAGE_KEYS) raw = raw ?? (await AsyncStorage.getItem(key));
        if (raw && !cancelled) {
          const parsed = JSON.parse(raw);
          if (parsed?.version === 1) {
            replaceState(migrate(parsed));
            if (mode === 'cloud') setReady(true); // show cached data while refreshing
          }
        }
        if (mode === 'cloud') {
          const saved = JSON.parse((await AsyncStorage.getItem(pendingKey)) ?? '[]');
          if (Array.isArray(saved) && !cancelled) {
            pending.current = saved;
            setUnsaved(saved.length);
          }
        }
      } catch {
        // Storage unavailable: carry on without the cache.
      }
      loaded.current = true;
      if (mode === 'local') {
        if (!cancelled) setReady(true);
        return;
      }
      await refreshRef.current();
      if (!cancelled) setReady(true);
      if (pending.current.length) void flush();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, userId]);

  // Save to this phone: all data in local mode, a cache in shared mode.
  useEffect(() => {
    if (!loaded.current) return;
    AsyncStorage.setItem(storageKey, JSON.stringify(state)).catch(() => {});
  }, [state, storageKey]);

  // Live updates from other people; a refresh whenever the app comes back, when
  // the connection returns, and every half minute while it's open (in case a
  // live update was missed).
  useEffect(() => {
    if (mode !== 'cloud' || !session) return;
    const stop = subscribe(scheduleRefresh);
    const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';
    const onVisible = () => {
      if (visible()) {
        wakeFlusher.current?.();
        scheduleRefresh();
      }
    };
    const onOnline = () => {
      wakeFlusher.current?.();
      scheduleRefresh();
    };
    const poll = setInterval(() => {
      if (visible()) scheduleRefresh();
    }, 30000);
    let removeNative: (() => void) | undefined;
    const web = Platform.OS === 'web' && typeof window !== 'undefined' && typeof document !== 'undefined';
    if (web) {
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('online', onOnline);
    } else {
      const sub = RNAppState.addEventListener('change', (s) => s === 'active' && onOnline());
      removeNative = () => sub.remove();
    }
    return () => {
      stop();
      clearInterval(poll);
      if (web) {
        document.removeEventListener('visibilitychange', onVisible);
        window.removeEventListener('online', onOnline);
      }
      removeNative?.();
    };
  }, [mode, session, scheduleRefresh]);

  // ---- Changes -----------------------------------------------------------------
  const dispatch = useCallback(
    (action: Action) => {
      const before = stateRef.current;
      replaceState(reducer(before, action));
      if (mode !== 'cloud') return;
      const ops = actionToOps(action, before);
      if (ops.length === 0) return;
      pending.current = [...pending.current, { id: uid(), action, ops }];
      savePending();
      wakeFlusher.current?.();
      void flush();
    },
    [mode, replaceState, savePending, flush],
  );

  // Looking someone up by email needs a connection; say so at once rather than queueing it.
  const needOnline = (e: unknown): never => {
    if (e instanceof CloudError && e.retry) {
      throw new CloudError('You need a connection to add someone by Gmail. Try again when you’re online.', true);
    }
    throw e;
  };

  const addPersonByEmail = useCallback(
    async (email: string, name?: string) => {
      if (!offlineRef.current) await whenSaved();
      const person = personFromRow(await apiAddPersonByEmail(email, name).catch(needOnline));
      const s = stateRef.current;
      replaceState({ ...s, people: { ...s.people, [person.id]: person } });
      scheduleRefresh();
      return person;
    },
    [whenSaved, replaceState, scheduleRefresh],
  );

  const setPersonEmail = useCallback(
    async (personId: Id, email: string) => {
      if (!offlineRef.current) await whenSaved();
      const id = await apiSetPersonEmail(personId, email).catch(needOnline);
      await refreshRef.current();
      return id;
    },
    [whenSaved],
  );

  const value = useMemo(
    () => ({
      state,
      dispatch,
      ready,
      mode,
      userId,
      email: mode === 'cloud' ? session?.user.email ?? null : null,
      refresh,
      syncError,
      clearSyncError: () => setSyncError(null),
      loadError,
      unsaved,
      offline,
      addPersonByEmail,
      setPersonEmail,
    }),
    [state, dispatch, ready, mode, userId, session, refresh, syncError, loadError, unsaved, offline, addPersonByEmail, setPersonEmail],
  );
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const s = useContext(StoreContext);
  if (!s) throw new Error('useStore must be used inside StoreProvider');
  return s;
}

/** Display name helper: "You" for the current user. */
export function useName() {
  const { state } = useStore();
  return (id: Id) => (id === state.meId ? 'You' : state.people[id]?.name ?? 'Someone');
}

const firstPayer = (e: Expense) => Object.keys(e.payers)[0];

// ---------------------------------------------------------------------------
// Sample data so the app can be explored straight away.

function sampleData(s: AppState): AppState {
  const me = s.meId!;
  const ravi: Person = { id: uid(), name: 'Ravi', upiId: 'ravi@okaxis' };
  const priya: Person = { id: uid(), name: 'Priya', upiId: 'priya@oksbi' };
  const arjun: Person = { id: uid(), name: 'Arjun' };
  const meena: Person = { id: uid(), name: 'Meena', upiId: 'meena@ybl' };
  const friends = [ravi, priya, arjun, meena];

  const day = (d: number) => new Date(Date.now() - d * 86400000).toISOString();

  const thai: Group = {
    id: uid(),
    name: 'Thailand trip',
    memberIds: [me, ravi.id, priya.id, arjun.id],
    simplifyDebts: true,
    createdAt: day(8),
    baseCurrency: 'INR',
    rates: { THB: 2.87 },
  };
  const goa: Group = {
    id: uid(),
    name: 'Goa trip',
    memberIds: [me, ravi.id, priya.id, arjun.id],
    simplifyDebts: true,
    createdAt: day(20),
    baseCurrency: 'INR',
    rates: {},
  };
  const flat: Group = {
    id: uid(),
    name: 'Flat 302',
    memberIds: [me, arjun.id, meena.id],
    simplifyDebts: true,
    createdAt: day(40),
    baseCurrency: 'INR',
    rates: {},
  };

  const ex = (
    g: Group,
    description: string,
    whole: number, // in whole units of `currency`
    paidBy: Id | Record<Id, number>, // one payer, or whole units paid by each
    d: number,
    opts: { participants?: Id[]; currency?: string } = {},
  ): Expense => {
    const participants = opts.participants ?? g.memberIds;
    const amount = whole * 100;
    const per = Math.floor(amount / participants.length);
    const shares: Record<Id, number> = {};
    participants.forEach((id, i) => {
      shares[id] = per + (i < amount - per * participants.length ? 1 : 0);
    });
    return {
      id: uid(),
      groupId: g.id,
      description,
      currency: opts.currency ?? g.baseCurrency,
      amount,
      payers:
        typeof paidBy === 'string'
          ? { [paidBy]: amount }
          : Object.fromEntries(Object.entries(paidBy).map(([id, r]) => [id, r * 100])),
      splitType: 'equal',
      participants,
      inputs: {},
      shares,
      date: day(d),
      createdAt: day(d),
    };
  };
  const THB = { currency: 'THB' };

  const expenses: Expense[] = [
    ex(thai, 'Flights to Bangkok', 72000, me, 7),
    ex(thai, 'Cab to Hyderabad airport', 1400, arjun.id, 7),
    ex(thai, 'Hostel in Bangkok, 3 nights', 7200, ravi.id, 6, THB),
    ex(thai, 'Street food at Yaowarat', 1860, priya.id, 5, THB),
    ex(thai, 'Long-tail boat in Krabi', 3200, { [me]: 2000, [arjun.id]: 1200 }, 3, THB),
    ex(goa, 'Villa in Anjuna, 3 nights', 18000, { [me]: 12000, [ravi.id]: 6000 }, 18),
    ex(goa, 'Scooter rentals', 2400, ravi.id, 17),
    ex(goa, 'Dinner at the beach shack', 3860, priya.id, 16),
    ex(goa, 'Fuel', 900, arjun.id, 16, { participants: [ravi.id, arjun.id] }),
    ex(goa, 'Cab to the airport', 1650, me, 15),
    ex(flat, 'September rent', 36000, meena.id, 30),
    ex(flat, 'Electricity bill', 2310, arjun.id, 12),
    ex(flat, 'Wi-Fi', 999, me, 9),
    ex(flat, 'Groceries from Ratnadeep', 1845, me, 3),
  ];

  const payments: Payment[] = [
    { id: uid(), groupId: goa.id, from: arjun.id, to: me, currency: 'INR', amount: 300000, baseAmount: 300000, date: day(10) },
    { id: uid(), groupId: thai.id, from: priya.id, to: me, currency: 'THB', amount: 200000, baseAmount: 574000, date: day(2) },
  ];

  const transfers: Transfer[] = [
    {
      id: uid(),
      kind: 'transfer',
      from: me,
      to: ravi.id,
      currency: 'INR',
      amount: 150000,
      note: 'Cash for concert tickets',
      date: day(12),
      createdAt: day(12),
    },
  ];

  const who = (id: Id) => (id === me ? 'You' : friends.find((p) => p.id === id)?.name ?? 'Someone');
  const activity: Activity[] = [
    { id: uid(), at: day(10), groupId: goa.id, text: 'Arjun paid you ₹3,000 in Goa trip' },
    { id: uid(), at: day(2), groupId: thai.id, text: 'Priya paid you ฿2,000 in Thailand trip' },
    { id: uid(), at: day(12), text: 'You gave Ravi ₹1,500 (Cash for concert tickets)' },
    ...expenses.map((e) => ({
      id: uid(),
      at: e.date,
      groupId: e.groupId,
      text: `${who(firstPayer(e))} added “${e.description}” (${formatMoney(e.amount, e.currency)})`,
    })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

  return {
    ...s,
    people: { ...s.people, ...Object.fromEntries(friends.map((p) => [p.id, p])) },
    groups: [thai, goa, flat, ...s.groups],
    expenses: [...expenses, ...s.expenses],
    payments: [...payments, ...s.payments],
    transfers: [...transfers, ...s.transfers],
    activity: [...activity, ...s.activity],
  };
}
