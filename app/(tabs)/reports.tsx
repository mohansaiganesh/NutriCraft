import { Alert, ScrollView, Text } from 'react-native';
import { importBackup, shareBackup } from '@/lib/backup';
import { AccountButton, AppHeader, Button, Card, Muted } from '@/components/ui';

function CardTitle({ children }: { children: React.ReactNode }) {
  return <Text className="font-display-sb text-[15px] text-ink mb-1">{children}</Text>;
}

export default function ReportsScreen() {
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

  return (
    <ScrollView className="flex-1 bg-paper" contentContainerClassName="px-4 pb-16 gap-[14px]">
      <AppHeader kicker="Your data" title="Reports" kickerBelow right={<AccountButton />} />

      <Card className="gap-3">
        <CardTitle>Backup</CardTitle>
        <Muted className="text-[12px] leading-[17px]">
          Export your foods, meals and logs to a JSON file, or merge one back in.
        </Muted>
        <Button label="Export data (JSON)" onPress={onExport} variant="secondary" className="py-[8px] rounded-xl" textClassName="text-[12px]" />
        <Button label="Import data (JSON)" onPress={onImport} variant="secondary" className="py-[8px] rounded-xl" textClassName="text-[12px]" />
      </Card>
    </ScrollView>
  );
}
