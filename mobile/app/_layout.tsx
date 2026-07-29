/**
 * app/_layout.tsx
 * Root layout for the mobile app using expo-router.
 *
 * Initialization order (fix for issue #32):
 *   AppInitProvider boots first → hydrates AsyncStorage state → sets
 *   isHydrated = true → AppInitContext flushes any queued deep-link URL →
 *   useDeepLink navigates.  Navigation never fires before state is ready.
 */
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';
import { ThemeProvider, themes } from './theme';
import { useDeepLink } from '../hooks/useDeepLink';
import { AppInitProvider } from '../src/context/AppInitContext';

function DeepLinkHandler() {
  useDeepLink();
  return null;
}

function AppShell() {
  const colorScheme = useColorScheme();
  const themeMode = colorScheme === 'dark' ? 'dark' : 'light';
  const theme = themes[themeMode];

  return (
    <ThemeProvider>
      {/* DeepLinkHandler is inside AppInitProvider so useAppInit() resolves */}
      <DeepLinkHandler />
      <StatusBar style={theme.statusBarStyle} />
      <Stack screenOptions={{
        headerStyle: { backgroundColor: theme.header },
        headerTintColor: theme.headerText,
        headerTitleStyle: { fontFamily: 'Lora_700Bold' },
      }}>
        <Stack.Screen name="index" options={{ title: 'Home' }} />
        <Stack.Screen name="projects" options={{ title: 'Projects' }} />
        <Stack.Screen name="projects/[id]" options={{ title: 'Project Details' }} />
        <Stack.Screen name="donate/[id]" options={{ title: 'Donate' }} />
        <Stack.Screen name="scan" options={{ title: 'Scan QR Code', headerShown: false }} />
        <Stack.Screen name="impact" options={{ title: 'My Impact' }} />
        <Stack.Screen name="profile/[address]" options={{ title: 'Donor Profile' }} />
        <Stack.Screen name="leaderboard" options={{ title: 'Leaderboard' }} />
        <Stack.Screen name="recurring" options={{ title: 'Monthly Giving' }} />
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <AppInitProvider>
      <AppShell />
    </AppInitProvider>
  );
}
