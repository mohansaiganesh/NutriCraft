import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconCatalog, IconGear, IconBowl, IconHome } from '@/components/icons';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarActiveTintColor: '#2F9E44',
        tabBarInactiveTintColor: '#9AA79B',
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopColor: '#E3EADD',
          borderTopWidth: 1,
          height: 56 + insets.bottom,
          paddingTop: 6,
          paddingBottom: insets.bottom + 8,
        },
        tabBarLabelStyle: {
          fontFamily: 'PlusJakartaSans_700Bold',
          fontSize: 11,
          lineHeight: 14,
          marginTop: 1,
          marginBottom: 0,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Home', tabBarIcon: ({ color }) => <IconHome size={22} color={color} /> }}
      />
      <Tabs.Screen
        name="foods"
        options={{ title: 'Foods', tabBarIcon: ({ color }) => <IconCatalog size={22} color={color} /> }}
      />
      <Tabs.Screen
        name="meals"
        options={{ title: 'Meals', tabBarIcon: ({ color }) => <IconBowl size={22} color={color} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', tabBarIcon: ({ color }) => <IconGear size={22} color={color} /> }}
      />
    </Tabs>
  );
}
