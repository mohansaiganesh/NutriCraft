import { Tabs } from 'expo-router';
import { IconGear, IconLeaf, IconPlate, IconToday } from '@/components/icons';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#2F9E44',
        tabBarInactiveTintColor: '#9AA79B',
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopColor: '#E3EADD',
          borderTopWidth: 1,
          paddingTop: 8,
        },
        tabBarLabelStyle: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11 },
        tabBarItemStyle: { paddingTop: 2 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Today', tabBarIcon: ({ color }) => <IconToday size={23} color={color} /> }}
      />
      <Tabs.Screen
        name="foods"
        options={{ title: 'Foods', tabBarIcon: ({ color }) => <IconLeaf size={23} color={color} /> }}
      />
      <Tabs.Screen
        name="meals"
        options={{ title: 'Meals', tabBarIcon: ({ color }) => <IconPlate size={23} color={color} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', tabBarIcon: ({ color }) => <IconGear size={23} color={color} /> }}
      />
    </Tabs>
  );
}
