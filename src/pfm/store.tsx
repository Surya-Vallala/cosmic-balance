// Money's data on this phone, and (shared mode) in your private rows on the
// server. Changes show at once and are saved here; in shared mode they're also
// queued and sent, so nothing is lost offline. Before the database has been
// updated for Money (version 8), everything stays on this phone and is sent
// once it has.

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, AppState as RNAppState } from 'react-native';
import { CloudError, fetchMoney, isMissingTable, saveMoney } from '../cloud/api';
import { toDay } from '../dates';
import { useStore } from '../store';
import type { Id } from '../types';
import {
  accountItem,
  applyItems,
  categoryItem,
  coalesce,
  linkItem,
  recordItem,
  removeAccount,
  removeCategory,
  repeatItem,
  repeatsDue,
  rowsToItems,
  settingsItems,
  turnOn as turnOnItems,
  withDefaults,
} from './data';
import { emptyMoney } from './defaults';
import { accountBalances, buildEntries, freeze, type Entry } from './logic';
import type { Account, Category, Item, MoneyData, MoneyRecord, MoneySettings, Repeat, SplitLink } from './types';

interface Saved {
  data: MoneyData;
  /** The newest change fetched from the server. */
  cursor: string | null;
}

export interface MoneyStore {
  ready: boolean;
  m: MoneyData;
  /** Money is turned on. */
  on: boolean;
  /** Everything in Money's list, newest first. */
  entries: Entry[];
  /** Each account's balance now, in its own currency. */
  balances: Record<Id, number>;
  /** Split items waiting for you to say which account. */
  sortOut: Entry[];
  /** Changes not yet on the server (shared mode). */
  unsaved: number;
  /** The database hasn't been updated for Money yet: saved on this phone only. */
  serverMissing: boolean;
  apply: (items: Item[]) => void;
  setSettings: (patch: Partial<MoneySettings>) => void;
  turnOn: (opts?: { accounts?: Account[]; categories?: boolean; currency?: string }) => void;
  /** Caught up with your other phones (always true on this phone only). */
  synced: boolean;
  /**
   * Before leaving a group (or removing a friend): keep what Money counted from
   * it, so your past spending and balances stay as they were.
   */
  keepHistory: (which: { groupId?: Id; friendId?: Id }) => void;
  saveAccount: (a: Account) => void;
  removeAccount: (id: Id) => void;
  saveCategory: (c: Category) => void;
  removeCategory: (id: Id) => void;
  saveRecord: (r: MoneyRecord) => void;
  deleteRecord: (id: Id) => void;
  saveRepeat: (r: Repeat) => void;
  deleteRepeat: (id: Id) => void;
  /** Say which account a split item used (null: don't track); `null` link removes it. */
  setLink: (key: string, link: Omit<SplitLink, 'id' | 'at'> | null) => void;
  /** A one-time tip was shown. */
  tipSeen: (tip: string) => void;
}

const MoneyContext = createContext<MoneyStore | null>(null);

/** The main currency to start with: the one your groups use most. */
function likelyCurrency(groups: { baseCurrency: string }[]): string {
  const count: Record<string, number> = {};
  for (const g of groups) count[g.baseCurrency] = (count[g.baseCurrency] ?? 0) + 1;
  return Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'INR';
}

export function MoneyProvider({ children }: { children: React.ReactNode }) {
  const { state, mode, userId } = useStore();
  const base = mode === 'cloud' ? `cosmic-khaata:cloud:${userId}` : 'cosmic-khaata:v1';
  const dataKey = `${base}:money`;
  const pendingKey = `${base}:money:pending`;
  const cloud = mode === 'cloud' && !!userId;

  const [m, setM] = useState<MoneyData>(() => emptyMoney(likelyCurrency(state.groups)));
  const mRef = useRef(m);
  const [ready, setReady] = useState(false);
  const loaded = useRef(false);
  const cursor = useRef<string | null>(null);
  const pending = useRef<Item[]>([]);
  const [unsaved, setUnsaved] = useState(0);
  const [serverMissing, setServerMissing] = useState(false);
  const alive = useRef(true);

  const replace = useCallback((next: MoneyData) => {
    mRef.current = next;
    setM(next);
  }, []);

  const persist = useCallback(() => {
    if (!loaded.current) return;
    const saved: Saved = { data: mRef.current, cursor: cursor.current };
    AsyncStorage.setItem(dataKey, JSON.stringify(saved)).catch(() => {});
    if (cloud) AsyncStorage.setItem(pendingKey, JSON.stringify(pending.current)).catch(() => {});
  }, [dataKey, pendingKey, cloud]);

  // ---- Talking to the server ---------------------------------------------------
  /** When each item was last sent: a fetch that started before that has an older copy. */
  const sentAt = useRef(new Map<string, number>());
  /** Caught up with the server at least once (always, on this phone only). */
  const syncedRef = useRef(!cloud);
  const [synced, setSynced] = useState(!cloud);
  // Timers call the latest flush.
  const flushRef = useRef<() => Promise<void>>(async () => {});
  const flushing = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(async () => {
    if (!cloud || !userId || flushing.current || !pending.current.length) return;
    flushing.current = true;
    if (retryTimer.current) clearTimeout(retryTimer.current);
    // Sent: off the queue (anything changed again meanwhile is a newer item and stays).
    const sent = (items: Item[]) => {
      const now = Date.now();
      for (const it of items) sentAt.current.set(`${it.kind}:${it.id}`, now);
      pending.current = pending.current.filter((p) => !items.includes(p));
      setUnsaved(pending.current.length);
      persist();
    };
    // Worth trying again later: no connection, a busy server, or a database not updated yet.
    const later = (e: unknown) => isMissingTable(e) || !(e instanceof CloudError) || e.retry;
    try {
      while (alive.current && pending.current.length) {
        const batch = pending.current.slice(0, 200);
        try {
          await saveMoney(userId, batch);
          sent(batch);
        } catch (e) {
          if (later(e)) throw e;
          // The server refused something in this batch (it shouldn't): send them one
          // by one, so only what it refuses is dropped and the rest is kept.
          for (const it of batch) {
            try {
              await saveMoney(userId, [it]);
            } catch (e2) {
              if (later(e2)) throw e2;
              console.warn('Money: a change was refused', it.kind, it.id, e2 instanceof Error ? e2.message : e2);
            }
            sent([it]);
          }
        }
      }
      setServerMissing(false);
    } catch (e) {
      if (isMissingTable(e)) setServerMissing(true);
      retryTimer.current = setTimeout(() => void flushRef.current(), isMissingTable(e) ? 120000 : 15000);
    } finally {
      flushing.current = false;
    }
  }, [cloud, userId, persist]);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const fetching = useRef(false);
  /** Fetch what changed on your other phones. True when it worked (or there's no server). */
  const pull = useCallback(async (): Promise<boolean> => {
    if (!cloud) return true;
    if (fetching.current) return false;
    fetching.current = true;
    const started = Date.now();
    try {
      // A little overlap, in case a change landed while the last fetch ran.
      const since = cursor.current ? new Date(new Date(cursor.current).getTime() - 120000).toISOString() : null;
      const rows = await fetchMoney(since);
      if (!alive.current) return false;
      setServerMissing(false);
      if (rows.length) {
        const waiting = new Set(pending.current.map((p) => `${p.kind}:${p.id}`));
        // Not over something waiting to be sent, or sent while this fetch was on its way.
        const newer = (k: string) => waiting.has(k) || (sentAt.current.get(k) ?? 0) >= started;
        const items = rowsToItems(rows).filter((it) => !newer(`${it.kind}:${it.id}`));
        cursor.current = rows.reduce((a, r) => (r.updated_at > a ? r.updated_at : a), cursor.current ?? '');
        replace(applyItems(mRef.current, items));
        persist();
      }
      if (!syncedRef.current) {
        syncedRef.current = true;
        setSynced(true);
      }
      return true;
    } catch (e) {
      if (isMissingTable(e)) {
        setServerMissing(true);
        // Nothing can be saved there yet, so there's nothing to catch up with.
        if (!syncedRef.current) {
          syncedRef.current = true;
          setSynced(true);
        }
      }
      return false;
    } finally {
      fetching.current = false;
    }
  }, [cloud, replace, persist]);

  // ---- Changes ----------------------------------------------------------------
  const apply = useCallback(
    (items: Item[]) => {
      if (!items.length) return;
      replace(applyItems(mRef.current, items));
      if (cloud) {
        pending.current = coalesce(pending.current, items);
        setUnsaved(pending.current.length);
      }
      persist();
      if (cloud) void flushRef.current();
    },
    [cloud, replace, persist],
  );

  /** Make what repeating transactions are due (only once caught up with the server). */
  const makeRepeats = useCallback(() => {
    if (!mRef.current.settings.enabled) return;
    apply(repeatsDue(mRef.current, toDay(), new Date().toISOString()));
  }, [apply]);

  // ---- Loading ------------------------------------------------------------------
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(dataKey);
        if (raw && !cancelled) {
          const saved = JSON.parse(raw) as Saved;
          if (saved?.data) {
            const d = { ...emptyMoney(), ...saved.data };
            replace({ ...d, settings: withDefaults(d.settings) });
            cursor.current = saved.cursor ?? null;
          }
        }
        if (cloud) {
          const q = JSON.parse((await AsyncStorage.getItem(pendingKey)) ?? '[]');
          if (Array.isArray(q) && !cancelled) {
            pending.current = q;
            setUnsaved(q.length);
          }
        }
      } catch {
        // Nothing saved, or storage unavailable: start empty.
      }
      if (cancelled) return;
      loaded.current = true;
      setReady(true);
      let caughtUp = true;
      if (cloud) {
        caughtUp = await pull();
        await flushRef.current();
      }
      // Repeats only from an up-to-date copy (else a phone that's behind could bring back a stopped one).
      if (!cancelled && caughtUp) makeRepeats();
    })();
    return () => {
      cancelled = true;
      alive.current = false;
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey]);

  // Coming back to the app: catch up with your other phones, send what's waiting,
  // and make anything due today. Also every couple of minutes while open.
  useEffect(() => {
    const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';
    let last = 0;
    const wake = () => {
      if (!visible() || Date.now() - last < 20000) return;
      last = Date.now();
      void (async () => {
        const caughtUp = await pull();
        await flushRef.current();
        if (caughtUp) makeRepeats();
      })();
    };
    const poll = setInterval(wake, 120000);
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', wake);
      window.addEventListener('online', wake);
      return () => {
        clearInterval(poll);
        document.removeEventListener('visibilitychange', wake);
        window.removeEventListener('online', wake);
      };
    }
    const sub = RNAppState.addEventListener('change', (s) => s === 'active' && wake());
    return () => {
      clearInterval(poll);
      sub.remove();
    };
  }, [pull, makeRepeats]);

  // ---- What screens read ------------------------------------------------------------
  const entries = useMemo(() => (m.settings.enabled ? buildEntries(m, state) : []), [m, state]);
  const balances = useMemo(() => accountBalances(m, state), [m, state]);
  const sortOut = useMemo(() => entries.filter((e) => e.sortOut), [entries]);

  // Turned on before catching up with your other phones: once caught up, finish
  // setting up (the day shares count from, and categories if there are none).
  const wantCategories = useRef(true);
  useEffect(() => {
    if (!synced || !m.settings.enabled || m.settings.startedOn) return;
    apply(turnOnItems(mRef.current, { today: toDay(), currency: likelyCurrency(state.groups), categories: wantCategories.current }));
  }, [synced, m.settings.enabled, m.settings.startedOn, apply, state.groups]);

  const setSettings = useCallback(
    (patch: Partial<MoneySettings>) => apply(settingsItems(mRef.current.settings, { ...mRef.current.settings, ...patch })),
    [apply],
  );

  const value: MoneyStore = useMemo(
    () => ({
      ready,
      m,
      on: m.settings.enabled,
      entries,
      balances,
      sortOut,
      unsaved,
      serverMissing,
      apply,
      setSettings,
      synced,
      turnOn: (opts = {}) => {
        wantCategories.current = opts.categories ?? true;
        if (!syncedRef.current) {
          // Not caught up with your other phones yet: they may have Money set up
          // already. Turn it on now; the start day and categories follow once caught up.
          const s = mRef.current.settings;
          apply([...settingsItems(s, { ...s, enabled: true, introSeen: true }), ...(opts.accounts ?? []).map(accountItem)]);
          return;
        }
        apply(
          turnOnItems(mRef.current, {
            today: toDay(),
            currency: opts.currency ?? likelyCurrency(state.groups),
            accounts: opts.accounts,
            categories: wantCategories.current,
          }),
        );
      },
      keepHistory: ({ groupId, friendId }) => {
        const items: Item[] = [];
        for (const e of entries) {
          const hit = groupId ? e.groupId === groupId : !!friendId && !!e.transfer && (e.transfer.from === friendId || e.transfer.to === friendId);
          if (!hit) continue;
          const frozen = freeze(mRef.current, state, e);
          if (!frozen) continue;
          const link = mRef.current.links[e.key];
          items.push(linkItem({ id: e.key, accountId: link?.accountId ?? null, amount: link?.amount, categoryId: link?.categoryId, at: new Date().toISOString(), frozen }));
        }
        apply(items);
      },
      saveAccount: (a) => apply([accountItem(a)]),
      removeAccount: (id) => apply(removeAccount(mRef.current, id)),
      saveCategory: (c) => apply([categoryItem(c)]),
      removeCategory: (id) => apply(removeCategory(mRef.current, id)),
      saveRecord: (r) => apply([recordItem(r)]),
      deleteRecord: (id) => apply([{ kind: 'record', id, data: null }]),
      saveRepeat: (r) => apply([repeatItem(r)]),
      deleteRepeat: (id) => apply([{ kind: 'repeat', id, data: null }]),
      setLink: (key, link) =>
        apply([link ? linkItem({ ...link, id: key, at: new Date().toISOString() }) : { kind: 'link', id: key, data: null }]),
      tipSeen: (tip) => {
        const s = mRef.current.settings;
        if (!s.tips.includes(tip)) apply(settingsItems(s, { ...s, tips: [...s.tips, tip] }));
      },
    }),
    [ready, synced, m, entries, balances, sortOut, unsaved, serverMissing, apply, setSettings, state],
  );

  return <MoneyContext.Provider value={value}>{children}</MoneyContext.Provider>;
}

export function useMoney(): MoneyStore {
  const v = useContext(MoneyContext);
  if (!v) throw new Error('useMoney must be used inside MoneyProvider');
  return v;
}

/** Money, or null outside its provider (for screens shared with Split). */
export function useMaybeMoney(): MoneyStore | null {
  return useContext(MoneyContext);
}
