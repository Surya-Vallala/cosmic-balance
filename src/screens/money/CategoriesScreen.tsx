// Editing categories: rename, reorder, add sub-categories, delete (a category
// in use is hidden instead, so old records keep their names) and bring back.
import React, { useEffect, useLayoutEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ScreenProps } from '../../navigation';
import { categoryInUse, categoryItem } from '../../pfm/data';
import { subCategories, topCategories } from '../../pfm/logic';
import { useMoney } from '../../pfm/store';
import type { Category, CategoryKind } from '../../pfm/types';
import { uid } from '../../store';
import { colors, space } from '../../theme';
import { List, Screen, SectionTitle, Segmented, styles as ui } from '../../ui';

const MAX = 40;

export default function CategoriesScreen({ navigation, route }: ScreenProps<'Categories'>) {
  const { m, apply, removeCategory } = useMoney();
  const [kind, setKind] = useState<CategoryKind>(route.params?.kind ?? 'expense');
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [addingSub, setAddingSub] = useState<string | null>(null);
  const [subText, setSubText] = useState('');
  const [newText, setNewText] = useState('');
  const [armed, setArmed] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  const subsOn = m.settings.subcategories;

  useLayoutEffect(() => {
    navigation.setOptions({ title: kind === 'expense' ? 'Expense categories' : 'Income categories' });
  }, [navigation, kind]);

  // A delete waits a few seconds for the second tap.
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  const tops = topCategories(m.categories, kind);
  const hidden = Object.values(m.categories)
    .filter((c) => c.kind === kind && (c.hidden || (c.parentId && m.categories[c.parentId]?.hidden)))
    .sort((a, b) => a.name.localeCompare(b.name));

  /** A name that's empty, too long or already used next to it. */
  const problem = (name: string, siblings: Category[], self?: string) => {
    const n = name.trim();
    if (!n) return 'Type a name.';
    if (n.length > MAX) return `Keep it under ${MAX} letters.`;
    if (siblings.some((c) => c.id !== self && c.name.trim().toLowerCase() === n.toLowerCase())) return 'There’s one with that name already.';
    return null;
  };
  const siblingsOf = (c: { parentId: string | null }) =>
    c.parentId ? subCategories(m.categories, c.parentId, true) : topCategories(m.categories, kind, true);

  const rename = (c: Category) => {
    const p = problem(editText, siblingsOf(c), c.id);
    if (p) return setError({ id: c.id, text: p });
    apply([categoryItem({ ...c, name: editText.trim() })]);
    setEditing(null);
    setError(null);
  };

  const move = (c: Category, dir: -1 | 1) => {
    const list = c.parentId ? subCategories(m.categories, c.parentId) : tops;
    const i = list.findIndex((x) => x.id === c.id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    // Number them in the order shown, then swap the two.
    const order = list.map((x) => x.id);
    [order[i], order[j]] = [order[j], order[i]];
    apply(order.map((id, k) => ({ ...m.categories[id], order: k })).filter((x) => m.categories[x.id].order !== x.order).map(categoryItem));
  };

  const add = (name: string, parentId: string | null, done: () => void, errId: string) => {
    const siblings = parentId ? subCategories(m.categories, parentId, true) : topCategories(m.categories, kind, true);
    const p = problem(name, siblings);
    if (p) {
      // An existing hidden one with that name: bring it back instead.
      const back = siblings.find((c) => c.hidden && c.name.trim().toLowerCase() === name.trim().toLowerCase());
      if (back) {
        apply([categoryItem({ ...back, hidden: false })]);
        done();
        return;
      }
      return setError({ id: errId, text: p });
    }
    const order = siblings.length ? Math.max(...siblings.map((x) => x.order)) + 1 : 0;
    apply([categoryItem({ id: uid(), kind, name: name.trim(), parentId, order })]);
    setError(null);
    done();
  };

  const bringBack = (c: Category) => {
    const items = [categoryItem({ ...c, hidden: false })];
    const parent = c.parentId ? m.categories[c.parentId] : undefined;
    if (parent?.hidden) items.push(categoryItem({ ...parent, hidden: false }));
    apply(items);
  };

  const remove = (c: Category) => {
    if (armed !== c.id) return setArmed(c.id);
    setArmed(null);
    removeCategory(c.id);
  };

  const row = (c: Category, index: number, count: number, sub: boolean) => {
    const isEditing = editing === c.id;
    const inUse = categoryInUse(m, c.id);
    const subCount = sub ? 0 : subCategories(m.categories, c.id).length;
    return (
      <View key={c.id}>
        <View style={[st.row, sub && st.subRow, ui.rowDivider]}>
          {isEditing ? (
            <View style={st.editLine}>
              <TextInput
                value={editText}
                onChangeText={(t) => {
                  setEditText(t);
                  setError(null);
                }}
                autoFocus
                maxLength={MAX + 5}
                onSubmitEditing={() => rename(c)}
                accessibilityLabel={`New name for ${c.name}`}
                placeholderTextColor={colors.placeholder}
                selectionColor={colors.star}
                style={st.input}
              />
              <SmallButton label="Save" onPress={() => rename(c)} primary />
              <SmallButton
                label="Cancel"
                onPress={() => {
                  setEditing(null);
                  setError(null);
                }}
              />
            </View>
          ) : (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Rename ${c.name}`}
                onPress={() => {
                  setEditing(c.id);
                  setEditText(c.name);
                  setError(null);
                }}
                style={{ flex: 1, minWidth: 0, paddingVertical: 6 }}
              >
                <Text style={[st.name, sub && { fontSize: 14, color: colors.textSoft }]} numberOfLines={1}>
                  {sub ? '› ' : ''}
                  {c.name}
                </Text>
                {!sub && !subsOn && subCount ? (
                  <Text style={st.small}>
                    {subCount} sub-categor{subCount === 1 ? 'y' : 'ies'}, hidden while sub-categories are off
                  </Text>
                ) : null}
              </Pressable>
              <IconButton label={`Move ${c.name} up`} text="↑" disabled={index === 0} onPress={() => move(c, -1)} />
              <IconButton label={`Move ${c.name} down`} text="↓" disabled={index === count - 1} onPress={() => move(c, 1)} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={armed === c.id ? `Tap again to ${inUse ? 'hide' : 'delete'} ${c.name}` : `Delete ${c.name}`}
                onPress={() => remove(c)}
                hitSlop={4}
                style={[st.delete, armed === c.id && st.deleteArmed]}
              >
                <Text style={[st.deleteText, armed === c.id && { color: colors.space }]}>
                  {armed === c.id ? (inUse ? 'Hide?' : 'Sure?') : '×'}
                </Text>
              </Pressable>
            </>
          )}
        </View>
        {error?.id === c.id ? <Text style={[ui.error, st.errorPad]}>{error.text}</Text> : null}
        {armed === c.id && inUse ? (
          <Text style={[st.small, st.errorPad, { paddingBottom: 6 }]}>Used by old records, so it’s hidden and kept for them.</Text>
        ) : null}
      </View>
    );
  };

  return (
    <Screen>
      <Segmented
        options={[
          { value: 'expense', label: 'Expense' },
          { value: 'income', label: 'Income' },
        ]}
        value={kind}
        onChange={(k) => {
          setKind(k);
          setEditing(null);
          setAddingSub(null);
          setError(null);
        }}
      />
      <Text style={[ui.hint, { marginBottom: space.md }]}>
        Tap a name to rename it: past records show the new name too. Deleting one that’s in use hides it instead.
      </Text>

      <List>
        {tops.map((c, i) => {
          const subs = subsOn ? subCategories(m.categories, c.id) : [];
          return (
            <View key={c.id}>
              {row(c, i, tops.length, false)}
              {subs.map((x, j) => row(x, j, subs.length, true))}
              {subsOn ? (
                addingSub === c.id ? (
                  <View style={[st.row, st.subRow, ui.rowDivider]}>
                    <View style={st.editLine}>
                      <TextInput
                        value={subText}
                        onChangeText={(t) => {
                          setSubText(t);
                          setError(null);
                        }}
                        autoFocus
                        maxLength={MAX + 5}
                        placeholder={`New sub-category under ${c.name}`}
                        placeholderTextColor={colors.placeholder}
                        selectionColor={colors.star}
                        accessibilityLabel={`New sub-category under ${c.name}`}
                        onSubmitEditing={() => add(subText, c.id, () => setSubText(''), `sub:${c.id}`)}
                        style={st.input}
                      />
                      <SmallButton label="Add" primary onPress={() => add(subText, c.id, () => setSubText(''), `sub:${c.id}`)} />
                      <SmallButton
                        label="Done"
                        onPress={() => {
                          setAddingSub(null);
                          setSubText('');
                          setError(null);
                        }}
                      />
                    </View>
                  </View>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Add a sub-category under ${c.name}`}
                    onPress={() => {
                      setAddingSub(c.id);
                      setSubText('');
                      setError(null);
                    }}
                    style={[st.row, st.subRow, ui.rowDivider]}
                  >
                    <Text style={st.addLink}>+ Sub-category</Text>
                  </Pressable>
                )
              ) : null}
              {error?.id === `sub:${c.id}` ? <Text style={[ui.error, st.errorPad]}>{error.text}</Text> : null}
            </View>
          );
        })}
        <View style={[st.row, { paddingVertical: space.sm }]}>
          <View style={st.editLine}>
            <TextInput
              value={newText}
              onChangeText={(t) => {
                setNewText(t);
                setError(null);
              }}
              maxLength={MAX + 5}
              placeholder={kind === 'expense' ? 'New category, like Pets' : 'New category, like Rent received'}
              placeholderTextColor={colors.placeholder}
              selectionColor={colors.star}
              accessibilityLabel="New category"
              onSubmitEditing={() => add(newText, null, () => setNewText(''), 'new')}
              style={st.input}
            />
            <SmallButton label="+ Add" primary disabled={!newText.trim()} onPress={() => add(newText, null, () => setNewText(''), 'new')} />
          </View>
        </View>
      </List>
      {error?.id === 'new' ? <Text style={ui.error}>{error.text}</Text> : null}
      {!tops.length ? <Text style={ui.hint}>No categories yet. Add the ones you use.</Text> : null}

      {hidden.length ? (
        <>
          <SectionTitle>Hidden</SectionTitle>
          <List>
            {hidden.map((c, i) => {
              const parent = c.parentId ? m.categories[c.parentId] : undefined;
              return (
                <View key={c.id} style={[st.row, i < hidden.length - 1 && ui.rowDivider]}>
                  <Text style={[st.name, { flex: 1, color: colors.textSoft }]} numberOfLines={1}>
                    {parent ? `${parent.name} › ` : ''}
                    {c.name}
                  </Text>
                  <SmallButton label="Bring back" onPress={() => bringBack(c)} />
                </View>
              );
            })}
          </List>
          <Text style={ui.hint}>Hidden ones aren’t offered when recording, but old records keep them.</Text>
        </>
      ) : null}
    </Screen>
  );
}

function IconButton({ label, text, onPress, disabled }: { label: string; text: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      aria-disabled={!!disabled}
      disabled={disabled}
      onPress={onPress}
      hitSlop={2}
      style={[st.iconButton, disabled && { opacity: 0.25 }]}
    >
      <Text style={st.iconText}>{text}</Text>
    </Pressable>
  );
}

function SmallButton({ label, onPress, primary, disabled }: { label: string; onPress: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={[st.smallButton, primary && st.smallButtonPrimary, disabled && { opacity: 0.4 }]}
    >
      <Text style={[st.smallButtonText, primary && { color: colors.onStar }]}>{label}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 48, paddingHorizontal: space.md, paddingLeft: space.lg },
  subRow: { paddingLeft: space.xl + space.sm, backgroundColor: 'rgba(28, 33, 73, 0.35)' },
  editLine: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 6 },
  input: {
    flex: 1,
    minWidth: 0,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.raised,
    color: colors.text,
    paddingHorizontal: space.md,
    fontSize: 15,
  },
  name: { fontSize: 15, color: colors.text },
  small: { fontSize: 12, color: colors.muted, marginTop: 2 },
  addLink: { fontSize: 14, color: colors.star, fontWeight: '600' },
  iconButton: { width: 34, height: 40, alignItems: 'center', justifyContent: 'center' },
  iconText: { fontSize: 18, color: colors.textSoft },
  delete: { minWidth: 34, height: 30, paddingHorizontal: 6, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginLeft: 2 },
  deleteArmed: { backgroundColor: colors.owe },
  deleteText: { fontSize: 15, color: colors.owe, fontWeight: '700' },
  smallButton: { height: 36, paddingHorizontal: space.md, borderRadius: 10, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  smallButtonPrimary: { backgroundColor: colors.star, borderColor: colors.star },
  smallButtonText: { fontSize: 13, fontWeight: '700', color: colors.text },
  errorPad: { paddingHorizontal: space.lg, marginTop: 0, paddingBottom: space.sm },
});
