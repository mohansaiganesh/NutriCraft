// Scenario: a careful user making a manual backup before switching phones — clear export/import
// controls plus an on-demand sync, all on the garden-paper ground.
import { Alert, ScrollView, Text, View } from 'react-native';
import { importBackup, shareBackup } from '@/lib/backup';
import { useSession } from '@/lib/session';
import { Button, Card, DetailHeader, Muted } from '@/components/ui';

function CardTitle({ children }: { children: React.ReactNode }) {
  return <Text className="font-display-sb text-[15px] text-ink mb-1">{children}</Text>;
}

export default function DataScreen() {
  const { sync } = useSession();

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

  const onSync = () => {
    sync();
    Alert.alert('Syncing', 'Your data is syncing with the cloud in the background.');
  };

  return (
    <View className="flex-1 bg-paper">
      <DetailHeader title="Data & sync" />
      <ScrollView contentContainerClassName="px-4 pb-16 gap-[14px]">
        <Card className="gap-3">
          <CardTitle>Cloud sync</CardTitle>
          <Muted className="text-[12.5px] leading-[18px] -mt-1">
            Your data syncs automatically across your devices and is restored when you reinstall.
            Tap below to sync right now.
          </Muted>
          <Button
            label="Sync now"
            onPress={onSync}
            className="py-[9px] rounded-xl"
            textClassName="text-[13px]"
          />
        </Card>

        <Card className="gap-3">
          <CardTitle>Backup</CardTitle>
          <Muted className="text-[12.5px] leading-[18px] -mt-1">
            Export your foods, meals and logs to a JSON file, or merge one back in.
          </Muted>
          <Button
            label="Export data (JSON)"
            onPress={onExport}
            variant="secondary"
            className="py-[9px] rounded-xl"
            textClassName="text-[13px]"
          />
          <Button
            label="Import data (JSON)"
            onPress={onImport}
            variant="secondary"
            className="py-[9px] rounded-xl"
            textClassName="text-[13px]"
          />
        </Card>
      </ScrollView>
    </View>
  );
}
