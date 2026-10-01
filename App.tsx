import { Sora_300Light, Sora_600SemiBold, Sora_700Bold, useFonts } from '@expo-google-fonts/sora';
import { createNavigationContainerRef, DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/auth';
import { Pulsar } from './src/cosmos';
import type { RootStackParamList } from './src/navigation';
import AboutScreen from './src/screens/AboutScreen';
import ExpenseFormScreen from './src/screens/ExpenseFormScreen';
import FriendFormScreen from './src/screens/FriendFormScreen';
import FriendScreen from './src/screens/FriendScreen';
import GroupFormScreen from './src/screens/GroupFormScreen';
import GroupScreen from './src/screens/GroupScreen';
import GroupSummaryScreen from './src/screens/GroupSummaryScreen';
import HomeScreen from './src/screens/HomeScreen';
import JoinScreen from './src/screens/JoinScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import SettleAllScreen from './src/screens/SettleAllScreen';
import SettleUpScreen from './src/screens/SettleUpScreen';
import TransferScreen from './src/screens/TransferScreen';
import WelcomeScreen from './src/screens/WelcomeScreen';
import { StoreProvider, useStore } from './src/store';
import { colors, fonts, space } from './src/theme';
import { Button, Empty } from './src/ui';

const Stack = createNativeStackNavigator<RootStackParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.space,
    card: colors.space,
    border: colors.line,
    primary: colors.star,
    text: colors.text,
  },
};

function Loading() {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.space,
      }}
    >
      <Pulsar size={64} />
    </View>
  );
}

/** Shown when shared data can't be loaded and nothing is saved on this phone yet. */
function LoadFailed() {
  const { loadError, refresh } = useStore();
  const { signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.space,
        justifyContent: 'center',
        padding: space.xl,
      }}
    >
      <Empty
        title="Couldn't load your khaata"
        body={loadError ?? 'Check your connection and try again.'}
        action={
          <View style={{ gap: space.sm }}>
            <Button
              title={busy ? 'Trying…' : 'Try again'}
              disabled={busy}
              onPress={async () => {
                setBusy(true);
                await refresh();
                setBusy(false);
              }}
            />
            <Button title="Sign out" variant="ghost" onPress={signOut} />
          </View>
        }
      />
    </View>
  );
}

/** A short message at the top when the database refused a change. */
function SyncToast() {
  const { syncError, clearSyncError } = useStore();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!syncError) return;
    const t = setTimeout(clearSyncError, 8000);
    return () => clearTimeout(t);
  }, [syncError, clearSyncError]);
  if (syncError) {
    return (
      <Pressable
        onPress={clearSyncError}
        accessibilityRole="alert"
        style={[styles.toast, { top: insets.top + space.sm }]}
      >
        <Text style={styles.toastText}>{syncError}</Text>
      </Pressable>
    );
  }
  return null;
}

/** A slim strip above everything while there's no connection (it pushes the screen down, never covers it). */
function OfflineStrip() {
  const { offline, unsaved } = useStore();
  const insets = useSafeAreaInsets();
  if (!offline) return null;
  return (
    <View accessibilityRole="alert" style={[styles.offline, { paddingTop: insets.top + 6 }]}>
      <Text style={styles.offlineText}>
        {unsaved > 0
          ? `Offline · ${unsaved} change${unsaved === 1 ? '' : 's'} saved on this phone, sent when you’re back online`
          : 'Offline · showing what was last loaded'}
      </Text>
    </View>
  );
}

/** If a screen ever fails to draw, offer a way back instead of a blank page. */
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean; attempt: number }> {
  state = { failed: false, attempt: 0 };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error('Cosmic Khaata crashed while drawing a screen', error);
  }
  render() {
    if (!this.state.failed) return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>;
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.space,
          justifyContent: 'center',
          padding: space.xl,
        }}
      >
        <Empty
          title="Something went wrong"
          body="Your data is safe. Reload to carry on."
          action={
            <Button
              title="Reload"
              onPress={() => {
                if (Platform.OS === 'web' && typeof window !== 'undefined') window.location.reload();
                else
                  this.setState((s) => ({
                    failed: false,
                    attempt: s.attempt + 1,
                  }));
              }}
            />
          }
        />
      </View>
    );
  }
}

function AppNavigator() {
  const { state, ready, mode, loadError } = useStore();
  const { pendingJoin } = useAuth();
  const [navReady, setNavReady] = useState(false);

  // Open the join screen for an invite link once signed in and loaded.
  useEffect(() => {
    if (mode === 'cloud' && ready && state.meId && pendingJoin && navReady && navigationRef.isReady()) {
      navigationRef.navigate('Join', { code: pendingJoin });
    }
  }, [mode, ready, state.meId, pendingJoin, navReady]);

  if (!ready) return <Loading />;
  if (mode === 'cloud' && !state.meId) return loadError ? <LoadFailed /> : <Loading />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.space }}>
      <OfflineStrip />
      <NavigationContainer ref={navigationRef} theme={navTheme} onReady={() => setNavReady(true)}>
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: colors.space },
            headerTintColor: colors.text,
            headerTitleStyle: { fontFamily: fonts.medium, fontSize: 17 },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: colors.space },
          }}
        >
          {!state.meId ? (
            <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{ headerShown: false }} />
          ) : (
            <>
              <Stack.Screen
                name="Home"
                component={HomeScreen}
                options={{ headerShown: false, title: 'Cosmic Khaata' }}
              />
              <Stack.Screen name="Group" component={GroupScreen} />
              <Stack.Screen name="GroupSummary" component={GroupSummaryScreen} options={{ title: 'Group summary' }} />
              <Stack.Screen name="GroupForm" component={GroupFormScreen} />
              <Stack.Screen name="ExpenseForm" component={ExpenseFormScreen} />
              <Stack.Screen name="SettleUp" component={SettleUpScreen} options={{ title: 'Settle up' }} />
              <Stack.Screen name="Friend" component={FriendScreen} />
              <Stack.Screen name="FriendForm" component={FriendFormScreen} />
              <Stack.Screen name="Transfer" component={TransferScreen} />
              <Stack.Screen name="SettleAll" component={SettleAllScreen} />
              <Stack.Screen name="About" component={AboutScreen} options={{ title: 'About' }} />
              <Stack.Screen name="Join" component={JoinScreen} options={{ title: 'Join a group' }} />
            </>
          )}
        </Stack.Navigator>
        <SyncToast />
      </NavigationContainer>
    </View>
  );
}

function Root() {
  const { mode, session } = useAuth();
  if (mode === 'loading') return <Loading />;
  if (mode === 'welcome') return <WelcomeScreen />;
  return (
    <StoreProvider key={`${mode}:${session?.user.id ?? ''}`} mode={mode} session={session}>
      <AppNavigator />
    </StoreProvider>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Sora_300Light,
    Sora_600SemiBold,
    Sora_700Bold,
  });
  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: colors.space }} />;
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={colors.space} />
      <ErrorBoundary>
        <AuthProvider>
          <Root />
        </AuthProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    backgroundColor: colors.raised,
    borderColor: colors.owe,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
  },
  toastText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  offline: {
    backgroundColor: colors.raised,
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    paddingBottom: 6,
    paddingHorizontal: space.lg,
  },
  offlineText: {
    color: colors.textSoft,
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
  },
});
