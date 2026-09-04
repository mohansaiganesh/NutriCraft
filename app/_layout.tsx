import '@/global.css';
import { ActivityIndicator, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import {
  BricolageGrotesque_600SemiBold,
  BricolageGrotesque_700Bold,
  BricolageGrotesque_800ExtraBold,
} from '@expo-google-fonts/bricolage-grotesque';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { useAppMigrations } from '@/db/migrate';
import { SessionProvider, useSession } from '@/lib/session';
import { AuthScreen } from '@/components/AuthScreen';

function Center({ children }: { children: React.ReactNode }) {
  return (
    <View className="flex-1 items-center justify-center bg-paper gap-3 p-6">{children}</View>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <Center>
      <ActivityIndicator size="large" color="#2F9E44" />
      <Text className="text-ink2 font-body">{label}</Text>
    </Center>
  );
}

/** App shell — mounted only once there's an active account (currentUserId is set). */
function AppStack() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#F6F8F3' },
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="food/[id]" options={{ presentation: 'modal' }} />
      <Stack.Screen name="meal/[id]" />
      <Stack.Screen name="pick-food" options={{ presentation: 'modal' }} />
    </Stack>
  );
}

/** Shown only in dev when the Supabase env vars are missing — an account is required. */
function Unconfigured() {
  return (
    <Center>
      <Text className="text-ink font-display text-[20px] text-center">Cloud not configured</Text>
      <Text className="text-ink2 font-body text-center leading-5">
        NutriCraft needs an account to run. Add EXPO_PUBLIC_SUPABASE_URL and
        EXPO_PUBLIC_SUPABASE_ANON_KEY to your .env file, then restart the dev server. See
        supabase/README.md for setup.
      </Text>
    </Center>
  );
}

/** Gate on auth/sync status: splash → sign-in → app. */
function SessionGate() {
  const { status } = useSession();

  if (status === 'loading') return <Loading label="Setting up NutriCraft…" />;
  if (status === 'unconfigured') return <Unconfigured />;
  if (status === 'signedOut') return <AuthScreen />;
  if (status === 'preparing') return <Loading label="Syncing your data…" />;
  return <AppStack />;
}

export default function RootLayout() {
  const { success, error } = useAppMigrations();
  const [fontsLoaded] = useFonts({
    BricolageGrotesque_600SemiBold,
    BricolageGrotesque_700Bold,
    BricolageGrotesque_800ExtraBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        {error ? (
          <Center>
            <Text className="text-over font-body-b">Database error</Text>
            <Text className="text-ink2 font-body text-center">{error.message}</Text>
          </Center>
        ) : !success || !fontsLoaded ? (
          // Migrations must finish before the SessionProvider touches the DB.
          <Loading label="Setting up NutriCraft…" />
        ) : (
          <SessionProvider>
            <SessionGate />
          </SessionProvider>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
