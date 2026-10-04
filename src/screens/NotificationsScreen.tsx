import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { relativeTime } from '../dates';
import type { ScreenProps } from '../navigation';
import { PushCard } from '../notify-ui';
import { useStore } from '../store';
import { colors, space } from '../theme';
import type { Notice } from '../types';
import { Empty, List, Row, Screen } from '../ui';

/** Everything that happened that concerns you, newest first (shared mode). */
export default function NotificationsScreen({ navigation }: ScreenProps<'Notifications'>) {
  const { state, markNoticesRead } = useStore();
  const notices = state.notices ?? [];
  // Which ones were new when the screen opened (they're marked read straight away).
  const [fresh] = useState(() => new Set(notices.filter((n) => !n.read).map((n) => n.id)));

  useEffect(() => {
    markNoticesRead();
  }, [markNoticesRead, notices.length]);

  const open = (n: Notice) => {
    if (n.groupId && state.groups.some((g) => g.id === n.groupId)) navigation.navigate('Group', { groupId: n.groupId });
    else if (n.personId && state.people[n.personId] && n.personId !== state.meId) {
      navigation.navigate('Friend', { friendId: n.personId });
    }
  };

  return (
    <Screen>
      <PushCard hideWhenOn />
      <View style={{ marginTop: space.lg }}>
        {notices.length === 0 ? (
          <List>
            <Empty
              title="Nothing yet"
              body="When friends add expenses, record payments, add you to a group or ask to join yours, it shows up here."
            />
          </List>
        ) : (
          <List>
            {notices.map((n, i) => (
              <Row
                key={n.id}
                left={<View style={[s.dot, fresh.has(n.id) && s.dotNew]} />}
                title={n.body}
                titleLines={3}
                subtitle={relativeTime(n.createdAt)}
                onPress={() => open(n)}
                last={i === notices.length - 1}
              />
            ))}
          </List>
        )}
      </View>
      <Text style={s.note}>Notifications never show amounts. Older ones are cleared after 60 days.</Text>
    </Screen>
  );
}

const s = StyleSheet.create({
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'transparent' },
  dotNew: { backgroundColor: colors.star },
  note: { fontSize: 12, color: colors.muted, marginTop: space.md, marginHorizontal: space.xs, lineHeight: 16 },
});
