import { Sora_300Light, Sora_600SemiBold, Sora_700Bold, useFonts } from '@expo-google-fonts/sora';
import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
import { StatusBar, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
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
import OnboardingScreen from './src/screens/OnboardingScreen';
import SettleAllScreen from './src/screens/SettleAllScreen';
import SettleUpScreen from './src/screens/SettleUpScreen';
import TransferScreen from './src/screens/TransferScreen';
import { StoreProvider, useStore } from './src/store';
import { colors, fonts } from './src/theme';

const Stack = createNativeStackNavigator<RootStackParamList>();

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

function Root() {
  const { state, ready } = useStore();
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.space }}>
        <Pulsar size={64} />
      </View>
    );
  }
  return (
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
          <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false, title: 'Cosmic Khaata' }} />
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
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({ Sora_300Light, Sora_600SemiBold, Sora_700Bold });
  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: colors.space }} />;
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <NavigationContainer theme={navTheme}>
          <StatusBar barStyle="light-content" backgroundColor={colors.space} />
          <Root />
        </NavigationContainer>
      </StoreProvider>
    </SafeAreaProvider>
  );
}
