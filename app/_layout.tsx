import '@/global.css';
import { useEffect, useState } from 'react';
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
import { ensureSettings } from '@/db/queries';
import { seedIfEmpty } from '@/lib/seed';

function Center({ children }: { children: React.ReactNode }) {
  return (
    <View className="flex-1 items-center justify-center bg-paper gap-3 p-6">{children}</View>
  );
}

export default function RootLayout() {
  const { success, error } = useAppMigrations();
  const [ready, setReady] = useState(false);
  const [fontsLoaded] = useFonts({
    BricolageGrotesque_600SemiBold,
    BricolageGrotesque_700Bold,
    BricolageGrotesque_800ExtraBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  useEffect(() => {
    if (!success) return;
    (async () => {
      try {
        await ensureSettings();
        await seedIfEmpty();
      } finally {
        setReady(true);
      }
    })();
  }, [success]);

  if (error) {
    return (
      <Center>
        <Text className="text-over font-body-b">Database error</Text>
        <Text className="text-ink2 font-body text-center">{error.message}</Text>
      </Center>
    );
  }

  if (!success || !ready || !fontsLoaded) {
    return (
      <Center>
        <ActivityIndicator size="large" color="#2F9E44" />
        {fontsLoaded ? (
          <Text className="text-ink2 font-body">Setting up NutriCraft…</Text>
        ) : (
          <Text className="text-ink2">Setting up NutriCraft…</Text>
        )}
      </Center>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
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
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
