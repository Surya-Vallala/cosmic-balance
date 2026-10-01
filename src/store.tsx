import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { formatMoney } from './money';
import type { Activity, AppState, Expense, Group, Id, Payment, Person, Transfer } from './types';

const STORAGE_KEY = 'cosmic-khaata:v1';
// Data saved under the app's earlier names; read once and carried over.
const LEGACY_STORAGE_KEYS = ['cosmic-split:v1', 'hisaab:v1'];

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
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

type Action =
  | { type: 'hydrate'; state: AppState }
  | { type: 'setup'; me: Person }
  | { type: 'loadSample' }
  | { type: 'savePerson'; person: Person }
  | { type: 'saveGroup'; group: Group }
  | { type: 'deleteGroup'; id: Id }
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
        payments: [p, ...s.payments],
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
      return {
        ...s,
        transfers: [t, ...s.transfers],
        payments: [...a.payments, ...s.payments],
        activity: log(s, `${nameOf(s, t.from)} settled up with ${to}: ${formatMoney(t.amount, t.currency)}${where}`),
      };
    }
    case 'reset':
      return emptyState;
  }
}

interface Store {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  ready: boolean;
}

const StoreContext = createContext<Store | null>(null);

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

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, emptyState);
  const [ready, setReady] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        let raw = await AsyncStorage.getItem(STORAGE_KEY);
        for (const key of LEGACY_STORAGE_KEYS) raw = raw ?? (await AsyncStorage.getItem(key));
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.version === 1) dispatch({ type: 'hydrate', state: migrate(parsed) });
        }
      } catch {
        // Storage unavailable: start fresh, the app still works in memory.
      } finally {
        loaded.current = true;
        setReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
  }, [state]);

  const value = useMemo(() => ({ state, dispatch, ready }), [state, ready]);
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
