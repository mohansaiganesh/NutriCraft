import { Tabs } from 'expo-router';
import { Text } from 'react-native';

const tabIcon =
  (emoji: string) =>
  ({ focused }: { focused: boolean }) => (
    <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>{emoji}</Text>
  );

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#0ea5e9',
        headerStyle: { backgroundColor: '#0ea5e9' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarIcon: tabIcon('📊') }} />
      <Tabs.Screen name="foods" options={{ title: 'Foods', tabBarIcon: tabIcon('🥗') }} />
      <Tabs.Screen name="meals" options={{ title: 'Meals', tabBarIcon: tabIcon('🍽️') }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: tabIcon('⚙️') }} />
    </Tabs>
  );
}
