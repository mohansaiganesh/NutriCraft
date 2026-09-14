import { Stack } from 'expo-router';

// The account area is a nested stack inside the root "account" modal group: a grouped menu
// (index) that pushes to dedicated detail screens. Each screen renders its own DetailHeader,
// so the native header stays hidden — matching the rest of the app.

// Anchor the stack to `index` so a deep push (e.g. Nico's history button → `traces`) always
// sits ON TOP of the account menu, even when the account tab hasn't been visited yet. Without
// this, a cold-start push mounts the pushed route as the stack's base, so back would unwind to
// the previous tab and the account tab icon would reopen the pushed screen. This anchor applies
// automatically on deep links; cross-navigator pushes (from the root-level Nico overlay) must
// still opt in with `{ withAnchor: true }` — see components/AssistantOverlay.tsx.
export const unstable_settings = { anchor: 'index' };

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
