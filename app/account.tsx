import { Alert, ScrollView, Text, View } from 'react-native';
import { useSession } from '@/lib/session';
import { Button, Card, DetailHeader, Muted } from '@/components/ui';

function CardTitle({ children }: { children: React.ReactNode }) {
  return <Text className="font-display-sb text-[15px] text-ink mb-1">{children}</Text>;
}

export default function AccountScreen() {
  const { email, signOut } = useSession();

  const onSignOut = () => {
    Alert.alert(
      'Sign out?',
      'You’ll return to the login screen, where you or a different user can sign in. Any changes not yet synced will upload next time you sign in.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
      ]
    );
  };

  return (
    <View className="flex-1 bg-paper">
      <DetailHeader title="Account" />
      <ScrollView contentContainerClassName="px-4 pb-16 gap-[14px]">
        <Card className="gap-3">
          <CardTitle>Session</CardTitle>
          <Muted className="text-[12px] leading-[17px]">
            {email ? `Signed in as ${email}.` : 'Signed in.'} Your data syncs across your devices
            and is restored when you reinstall. Sign out to switch to a different account on this
            device.
          </Muted>
          <Button label="Sign out" onPress={onSignOut} variant="danger" className="py-[8px] rounded-xl" textClassName="text-[12px]" />
        </Card>

        <Muted className="text-center text-[12px] mt-2">
          NutriCraft · local-first + cloud sync
        </Muted>
      </ScrollView>
    </View>
  );
}
