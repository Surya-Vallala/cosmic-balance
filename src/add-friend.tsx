// Adding a friend without leaving what you're recording (a transfer, an
// expense outside groups): a "+ Add a friend" chip that opens a name box.
// They don't need Cosmic Balance: a name is enough. In shared mode a Gmail
// address links their account, now or when they first sign in.

import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { isEmail } from './emails';
import { friendNamed } from './search';
import { uid, useStore } from './store';
import { colors, space } from './theme';
import type { Id } from './types';
import { Button, styles as ui } from './ui';

export interface AddFriend {
  /** The "+ Add a friend" chip, to put at the end of a row of people. */
  chip: React.ReactNode;
  /** The name box (when open), to put under that row. */
  panel: React.ReactNode;
  /** Add someone straight away by this name (from a search that found nobody). */
  addNamed: (name: string) => void;
  busy: boolean;
}

export function useAddFriend({ onAdded, prefill = '', label = 'Add a friend' }: { onAdded: (id: Id) => void; prefill?: string; label?: string }): AddFriend {
  const { state, dispatch, mode, addPersonByEmail } = useStore();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // The latest callback (it may close over the form's latest choices).
  const added = useRef(onAdded);
  useEffect(() => {
    added.current = onAdded;
  });
  const cloud = mode === 'cloud';

  const add = async (typed: string) => {
    const n = typed.trim();
    if (!n || busy) return;
    setError(null);
    setNote(null);
    if (cloud && isEmail(n)) {
      setBusy(true);
      try {
        const p = await addPersonByEmail(n);
        if (p.id === state.meId) throw new Error('That’s your own email address.');
        added.current(p.id);
        setNote(p.userId ? `${p.name} is on Cosmic Balance: they’ll see this once it’s saved.` : `Added ${n}. They’ll see this when they sign in with that Gmail.`);
        setName('');
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Couldn’t add them. Try again.');
      } finally {
        setBusy(false);
      }
      return;
    }
    const existing = friendNamed(state.people, state.meId, n);
    if (existing) {
      added.current(existing.id);
      setNote(`${existing.name} is already your friend: picked.`);
    } else {
      const id = uid();
      dispatch({ type: 'savePerson', person: { id, name: n.replace(/\s+/g, ' ') } });
      added.current(id);
      setNote(
        cloud
          ? `Added ${n}. They don’t need Cosmic Balance; if they join later, send their invite from their page under Friends.`
          : `Added ${n} to your friends.`,
      );
    }
    setName('');
    setOpen(false);
  };

  const chip = (
    <Pressable
      key="add-friend"
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        setOpen(true);
        setError(null);
        setNote(null);
        setName(prefill.trim());
      }}
      style={({ pressed }) => [s.chip, pressed && { backgroundColor: colors.raised }]}
    >
      <Text style={s.plus}>+</Text>
      <Text style={s.chipText}>{label}</Text>
    </Pressable>
  );

  const panel = open ? (
    <View style={s.panel}>
      <View style={s.row}>
        <TextInput
          value={name}
          onChangeText={setName}
          autoFocus
          placeholder={cloud ? 'Their name, or their Gmail' : 'Their name'}
          placeholderTextColor={colors.placeholder}
          keyboardAppearance="dark"
          selectionColor={colors.star}
          style={[ui.input, { flex: 1 }]}
          onSubmitEditing={() => void add(name)}
          returnKeyType="done"
          autoCapitalize="words"
          autoCorrect={false}
          maxLength={60}
          accessibilityLabel={cloud ? 'New friend’s name or Gmail' : 'New friend’s name'}
        />
        <Button title={busy ? 'Adding…' : 'Add'} small onPress={() => void add(name)} disabled={!name.trim() || busy} style={{ minHeight: 48 }} />
      </View>
      <Pressable accessibilityRole="button" onPress={() => setOpen(false)} hitSlop={6} style={{ alignSelf: 'flex-start' }}>
        <Text style={s.cancel}>Cancel</Text>
      </Pressable>
      {error ? <Text style={ui.error}>{error}</Text> : null}
      <Text style={[ui.hint, { marginTop: 4 }]}>
        {cloud
          ? 'A name is enough: they don’t need Cosmic Balance. If you know their Gmail, use that and it links to them when they sign in.'
          : 'A name is enough. They’re added to your friends too.'}
      </Text>
    </View>
  ) : error || note ? (
    <Text style={[ui.hint, error && { color: colors.owe }]}>{error ?? note}</Text>
  ) : null;

  return { chip, panel, addNamed: (n) => void add(n), busy };
}

/** "No friend matches “Deepak”. Add Deepak as a friend" under a search that found nobody. */
export function NoMatchAdd({ query, onAdd, busy }: { query: string; onAdd: () => void; busy?: boolean }) {
  const q = query.trim();
  if (!q) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 4 }}>
      <Text style={[ui.hint, { marginTop: 0 }]}>No friend matches “{q}”.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Add ${q} as a friend`} onPress={onAdd} disabled={busy} hitSlop={6}>
        <Text style={s.link}>{busy ? 'Adding…' : `Add “${q}” as a friend`}</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.star,
  },
  plus: { color: colors.star, fontSize: 16, fontWeight: '700', lineHeight: 18 },
  chipText: { color: colors.star, fontSize: 14, fontWeight: '600' },
  panel: { marginTop: space.sm, gap: 6 },
  row: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  cancel: { color: colors.textSoft, fontSize: 13, fontWeight: '600', paddingVertical: 2 },
  link: { color: colors.star, fontSize: 13, fontWeight: '600' },
});
