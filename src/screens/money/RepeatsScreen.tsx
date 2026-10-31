// Repeating transactions: rent, EMIs, subscriptions. Each is recorded on its
// day automatically; stopping one keeps what it already recorded.
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { toDay } from '../../dates';
import { formatMoney } from '../../money';
import type { ScreenProps } from '../../navigation';
import { categoryPath, EVERY_LABEL, nextDue, shortMonth } from '../../pfm/logic';
import { useMoney } from '../../pfm/store';
import type { Repeat } from '../../pfm/types';
import { colors, fonts, space } from '../../theme';
import { Empty, List, Screen, styles as ui } from '../../ui';

/** "5 Nov", or "5 Nov 2027" in another year. */
function shortDay(day: string, now = new Date()): string {
  const [y, m, d] = day.split('-').map(Number);
  return `${d} ${shortMonth(m - 1)}${y === now.getFullYear() ? '' : ` ${y}`}`;
}

export default function RepeatsScreen({ navigation }: ScreenProps<'Repeats'>) {
  const { m, deleteRepeat } = useMoney();
  const [armed, setArmed] = useState<string | null>(null);
  const today = toDay();

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  const list = Object.values(m.repeats)
    .map((r) => ({ r, next: nextDue(r, today) }))
    // Soonest first; ones that have ended go last.
    .sort((a, b) => (a.next ?? '9999').localeCompare(b.next ?? '9999'));

  if (!list.length) {
    return (
      <Screen>
        <Empty
          title="Nothing repeats yet"
          body="When you record rent or an EMI, tap Repeat on the form and it’s recorded for you each time."
        />
      </Screen>
    );
  }

  const title = (r: Repeat) => {
    const t = r.template;
    if (t.note?.trim()) return t.note.trim();
    if (t.kind === 'transfer') return 'Transfer';
    return categoryPath(m.categories, t.categoryId).join(' › ');
  };

  return (
    <Screen>
      <Text style={[ui.hint, { marginTop: 0, marginBottom: space.md }]}>
        Each one is recorded on its day, the next time you open the app. Tap one to see what it last recorded.
      </Text>
      <List>
        {list.map(({ r, next }, i) => {
          const t = r.template;
          const acc = m.accounts[t.accountId];
          const to = t.toAccountId ? m.accounts[t.toAccountId] : undefined;
          const where = t.kind === 'transfer' ? `${acc?.name ?? 'Deleted account'} → ${to?.name ?? 'Deleted account'}` : acc?.name ?? 'Deleted account';
          const when = next ? `next ${shortDay(next)}` : r.until ? `ended ${shortDay(r.until)}` : 'ended';
          const color = t.kind === 'income' ? colors.owed : t.kind === 'expense' ? colors.owe : colors.text;
          // The latest record it made, to open.
          const last = r.lastMade ? m.records[`${r.id}-${r.lastMade}`] : undefined;
          const body = (
            <View style={st.textCol}>
              <Text style={st.title} numberOfLines={1}>
                {title(r)}
              </Text>
              <Text style={st.sub} numberOfLines={2}>
                {EVERY_LABEL[r.every]} · {when} · {where}
              </Text>
            </View>
          );
          return (
            <View key={r.id} style={[st.row, i < list.length - 1 && ui.rowDivider]}>
              {last ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${title(r)}, ${EVERY_LABEL[r.every].toLowerCase()}. Open the last one recorded`}
                  onPress={() => navigation.navigate('Record', { recordId: last.id })}
                  style={{ flex: 1, minWidth: 0 }}
                >
                  {body}
                </Pressable>
              ) : (
                <View style={{ flex: 1, minWidth: 0 }}>{body}</View>
              )}
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <Text style={[st.amount, { color }]}>{formatMoney(t.amount, acc?.currency ?? m.settings.currency)}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={armed === r.id ? `Tap again to stop ${title(r)}` : `Stop repeating ${title(r)}`}
                  onPress={() => {
                    if (armed !== r.id) return setArmed(r.id);
                    setArmed(null);
                    deleteRepeat(r.id);
                  }}
                  hitSlop={6}
                  style={[st.stop, armed === r.id && st.stopArmed]}
                >
                  <Text style={[st.stopText, armed === r.id && { color: colors.space }]}>{armed === r.id ? 'Tap to stop' : 'Stop'}</Text>
                </Pressable>
              </View>
            </View>
          );
        })}
      </List>
      <Text style={ui.hint}>Stopping one keeps everything it has already recorded.</Text>
    </Screen>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg },
  textCol: { minWidth: 0 },
  title: { fontSize: 15, color: colors.text, fontWeight: '600' },
  sub: { fontSize: 12, color: colors.muted, marginTop: 3, lineHeight: 17 },
  amount: { fontFamily: fonts.medium, fontSize: 14 },
  stop: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: colors.owe },
  stopArmed: { backgroundColor: colors.owe },
  stopText: { fontSize: 12, fontWeight: '700', color: colors.owe },
});
