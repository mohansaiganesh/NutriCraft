import { Alert, ScrollView, Text, View } from 'react-native';
import { useSession } from '@/lib/session';
import { importBackup, shareBackup } from '@/lib/backup';
import { Button, Card, DetailHeader, Muted } from '@/components/ui';

function CardTitle({ children }: { children: React.ReactNode }) {
  return <Text className="font-display-sb text-[15px] text-ink mb-1">{children}</Text>;
}

export default function AccountScreen() {
  const { email, signOut } = useSession();

  const onExport = async () => {
    try {
      await shareBackup();
    } catch (e: any) {
      Alert.alert('Export failed', String(e?.message ?? e));
    }
  };

  const onImport = async () => {
    try {
      const res = await importBackup();
      if (!res) return; // cancelled
      Alert.alert(
        'Import complete',
        `Foods: ${res.foods}, Meals: ${res.meals}, Meal items: ${res.mealItems}, Logs: ${res.logs}`
      );
    } catch (e: any) {
      Alert.alert('Import failed', String(e?.message ?? e));
    }
  };

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

        <Card className="gap-3">
          <CardTitle>Backup</CardTitle>
          <Muted className="text-[12px] leading-[17px]">
            Export your foods, meals and logs to a JSON file, or merge one back in.
          </Muted>
          <Button label="Export data (JSON)" onPress={onExport} variant="secondary" className="py-[8px] rounded-xl" textClassName="text-[12px]" />
          <Button label="Import data (JSON)" onPress={onImport} variant="secondary" className="py-[8px] rounded-xl" textClassName="text-[12px]" />
        </Card>

        <Muted className="text-center text-[12px] mt-2">
          NutriCraft · local-first + cloud sync
        </Muted>
      </ScrollView>
    </View>
  );
}
