// Scenario: a user glancing at what version they're on before reporting something — a quiet,
// informational screen, nothing to configure.
import { Linking, ScrollView, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { Card, DetailHeader, MenuRow, Muted } from '@/components/ui';
import { IconInfo, IconLeaf } from '@/components/icons';

const VERSION = Constants.expoConfig?.version ?? '1.0.0';

export default function AboutScreen() {
  return (
    <View className="flex-1 bg-paper">
      <DetailHeader title="About" />
      <ScrollView contentContainerClassName="px-4 pb-16 gap-[14px]">
        <Card className="items-center gap-2 py-6">
          <View
            className="w-[56px] h-[56px] rounded-2xl items-center justify-center"
            style={{ backgroundColor: '#EAF7EC' }}
          >
            <IconLeaf size={28} color="#2F9E44" />
          </View>
          <Text className="font-display text-[22px] text-ink mt-1">NutriCraft</Text>
          <Muted className="text-[12.5px] text-ink3">Version {VERSION}</Muted>
          <Muted className="text-[12.5px] text-ink2 text-center max-w-[260px] mt-1">
            Local-first food & calorie tracking with cloud sync.
          </Muted>
        </Card>

        <Card className="py-1">
          <MenuRow
            icon={IconInfo}
            label="Privacy policy"
            onPress={() => Linking.openURL('https://example.com/privacy')}
          />
          <MenuRow
            icon={IconInfo}
            label="Terms of service"
            onPress={() => Linking.openURL('https://example.com/terms')}
            divider
          />
        </Card>

        <Muted className="text-center text-[12px] text-ink3 mt-1">
          NutriCraft · local-first + cloud sync
        </Muted>
      </ScrollView>
    </View>
  );
}
