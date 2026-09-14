import { Stack } from 'expo-router';

// The account area is a nested stack inside the root "account" modal group: a grouped menu
// (index) that pushes to dedicated detail screens. Each screen renders its own DetailHeader,
// so the native header stays hidden — matching the rest of the app.
export default function AccountLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#F6F8F3' } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="preferences" />
      <Stack.Screen name="assistant" />
      <Stack.Screen name="profile" />
      <Stack.Screen name="security" />
      <Stack.Screen name="data" />
      <Stack.Screen name="about" />
      <Stack.Screen name="traces" />
      <Stack.Screen name="trace/[id]" />
    </Stack>
  );
}
