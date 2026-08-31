import '@/global.css';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useAppMigrations } from '@/db/migrate';
import { ensureSettings } from '@/db/queries';
import { seedIfEmpty } from '@/lib/seed';

function Center({ children }: { children: React.ReactNode }) {
  return (
    <View className="flex-1 items-center justify-center bg-neutral-50 dark:bg-black gap-3 p-6">
      {children}
    </View>
  );
}

export default function RootLayout() {
  const { success, error } = useAppMigrations();
  const [ready, setReady] = useState(false);

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
        <Text className="text-red-500 font-semibold">Database error</Text>
        <Text className="text-neutral-500 text-center">{error.message}</Text>
      </Center>
    );
  }

  if (!success || !ready) {
    return (
      <Center>
        <ActivityIndicator size="large" color="#0ea5e9" />
        <Text className="text-neutral-500">Setting up NutriCraft…</Text>
      </Center>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: '#0ea5e9' },
            headerTintColor: '#fff',
            headerTitleStyle: { fontWeight: '700' },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="food/[id]" options={{ presentation: 'modal', title: 'Food' }} />
          <Stack.Screen name="meal/[id]" options={{ title: 'Meal' }} />
          <Stack.Screen name="pick-food" options={{ presentation: 'modal', title: 'Add food' }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
