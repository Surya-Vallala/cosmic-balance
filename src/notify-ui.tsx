// Notification pieces shared by several screens: the bell on the home
// screen and the card that turns phone notifications on or off.
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { pushState, testPush, turnOffPush, turnOnPush, type PushState, type TestResult } from './push';
import { colors, fonts, radius, space } from './theme';
import { Button } from './ui';

export function Bell({ count, onPress }: { count: number; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={count ? `Notifications, ${count} new` : 'Notifications'}
      onPress={onPress}
      hitSlop={8}
      style={s.bell}
    >
      <Svg width={22} height={22} viewBox="0 0 24 24">
        <Path
          d="M12 3.2c-3.1 0-5.4 2.4-5.4 5.5v3.6c0 .7-.3 1.4-.8 1.9l-1 1.1c-.5.6-.1 1.5.7 1.5h13c.8 0 1.2-.9.7-1.5l-1-1.1c-.5-.5-.8-1.2-.8-1.9V8.7c0-3.1-2.3-5.5-5.4-5.5z"
          fill="none"
          stroke={colors.textSoft}
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
        <Path d="M9.8 19.2c.4 1 1.2 1.6 2.2 1.6s1.8-.6 2.2-1.6" fill="none" stroke={colors.textSoft} strokeWidth={1.6} strokeLinecap="round" />
      </Svg>
      {count > 0 ? (
        <View style={s.count} pointerEvents="none">
          <Text style={s.countText}>{count > 9 ? '9+' : count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const COPY: Record<PushState, string> = {
  unsupported: 'This browser can’t show notifications. Open Cosmic Balance from your home screen, in Chrome on Android or Safari on iPhone.',
  install:
    'On iPhone, notifications work once Cosmic Balance is on your Home Screen: tap Share, then “Add to Home Screen”, and open it from there.',
  blocked:
    'Notifications are turned off for Cosmic Balance in your phone’s settings. Turn them on there (site or app settings → Notifications), then come back.',
  off: 'Get a notification when friends add expenses, record payments, add you to a group or ask to join yours. Amounts are never shown.',
  on: 'This phone gets a notification when a friend adds or changes something that includes you (not for your own changes). Amounts are never shown.',
};

/** What the test found, in words. */
function testText(r: TestResult): { text: string; good: boolean } {
  switch (r.kind) {
    case 'accepted':
      return {
        good: true,
        text: 'Sent, and your phone’s push service accepted it. It should pop up in a few seconds. If it doesn’t, your phone is holding it back: in the phone’s Settings, allow notifications for Cosmic Balance (or for Chrome, if Cosmic Balance isn’t listed), and turn off battery saving for it.',
      };
    case 'renewed':
      return {
        good: true,
        text: 'This phone’s notification address had expired, so it’s been renewed. Tap Send a test again.',
      };
    case 'refused':
      return {
        good: false,
        text: `Your phone’s push service refused it (code ${r.status}). This needs fixing on the server: send this code to whoever set up Cosmic Balance.`,
      };
    case 'unreachable':
      return { good: false, text: 'The server couldn’t reach your phone’s push service. Try again in a minute.' };
    default:
      return {
        good: true,
        text: 'Sent. If nothing pops up within a minute, allow notifications for Cosmic Balance in your phone’s Settings.',
      };
  }
}

/** Shows whether this phone gets notifications, with a button to turn them on or off. */
export function PushCard({ compact = false, hideWhenOn = false }: { compact?: boolean; hideWhenOn?: boolean }) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ text: string; good: boolean } | null>(null);

  const check = useCallback(() => {
    pushState()
      .then(setState)
      .catch(() => setState('unsupported'));
  }, []);
  useEffect(check, [check]);

  if (!state || (hideWhenOn && state === 'on')) return null;

  const on = async () => {
    setBusy(true);
    setError(null);
    try {
      setState(await turnOnPush());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t turn on notifications. Try again.');
    }
    setBusy(false);
  };
  const test = async () => {
    setTesting(true);
    setError(null);
    setResult(null);
    try {
      setResult(testText(await testPush()));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t send a test. Try again.');
    }
    setTesting(false);
  };
  const off = async () => {
    setBusy(true);
    setError(null);
    setState(await turnOffPush().catch(() => 'off' as const));
    setBusy(false);
  };

  return (
    <View style={[s.card, compact && { padding: space.md }]}>
      <Text style={s.title}>{state === 'on' ? 'Notifications are on' : 'Phone notifications'}</Text>
      <Text style={s.body}>{COPY[state]}</Text>
      {state === 'off' ? (
        <Button title={busy ? 'Turning on…' : 'Turn on notifications'} onPress={on} disabled={busy} style={{ marginTop: space.md }} />
      ) : null}
      {state === 'on' ? (
        <View style={s.actions}>
          <View style={{ flex: 1 }}>
            <Button
              title={testing ? 'Sending…' : 'Send a test'}
              variant="secondary"
              onPress={test}
              disabled={testing || busy}
              accessibilityLabel="Send a test notification to this phone"
            />
          </View>
          {compact ? null : (
            <View style={{ flex: 1 }}>
              <Button title={busy ? 'Turning off…' : 'Turn off'} variant="ghost" onPress={off} disabled={busy || testing} accessibilityLabel="Turn off notifications on this phone" />
            </View>
          )}
        </View>
      ) : null}
      {result ? <Text style={[s.result, { color: result.good ? colors.owed : colors.owe }]}>{result.text}</Text> : null}
      {state === 'blocked' ? (
        <Button title="I’ve turned them on" variant="secondary" onPress={check} style={{ marginTop: space.md }} />
      ) : null}
      {error ? <Text style={s.error}>{error}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  bell: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  count: {
    position: 'absolute',
    top: -2,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.star,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.space,
  },
  countText: { fontSize: 10, fontWeight: '700', color: colors.onStar },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    padding: space.lg,
  },
  title: { fontFamily: fonts.medium, fontSize: 15, color: colors.text },
  body: { fontSize: 13, color: colors.muted, marginTop: 4, lineHeight: 18 },
  error: { fontSize: 13, color: colors.owe, marginTop: space.sm, fontWeight: '600', lineHeight: 18 },
  result: { fontSize: 13, marginTop: space.sm, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
});
