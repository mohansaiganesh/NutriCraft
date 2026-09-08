// Scenario: someone tidying up their profile on the couch after logging dinner — a calm,
// scannable account hub, grouped the way a real app's settings are, on the garden-paper ground.
import { Alert, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { settingsQuery } from '@/db/queries';
import { useSession } from '@/lib/session';
import { Button, Card, DetailHeader, MenuRow, SectionLabel } from '@/components/ui';
import { IconCloud, IconInfo, IconLock, IconTarget, IconUser } from '@/components/icons';

export default function AccountMenuScreen() {
  const { email, signOut } = useSession();
  const { data } = useLiveQuery(settingsQuery());
  const settings = data?.[0];
  const name = settings?.displayName?.trim() || null;
  const initial = (name ?? email ?? '?').charAt(0).toUpperCase();

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
      <ScrollView contentContainerClassName="px-4 pb-16 gap-[18px]">
        {/* Profile summary */}
        <Card className="flex-row items-center gap-[14px]">
          <View
            className="w-[54px] h-[54px] rounded-full items-center justify-center"
            style={{ backgroundColor: '#EAF7EC' }}
          >
            <Text className="font-display text-[24px] text-brand-ink">{initial}</Text>
          </View>
          <View className="flex-1">
            <Text className="font-display-sb text-[18px] text-ink" numberOfLines={1}>
              {name ?? 'Add your name'}
            </Text>
            <Text className="font-body text-[13px] text-ink2 mt-[2px]" numberOfLines={1}>
              {email ?? 'Signed in'}
            </Text>
          </View>
        </Card>

        <View>
          <SectionLabel>Account</SectionLabel>
          <Card className="py-1">
            <MenuRow
              icon={IconUser}
              label="Profile"
              sublabel="Name, age, country, phone"
              onPress={() => router.push('/account/profile')}
            />
            <MenuRow
              icon={IconLock}
              label="Security & login"
              sublabel="Password, email, delete account"
              onPress={() => router.push('/account/security')}
              divider
            />
            <MenuRow
              icon={IconTarget}
              label="Preferences"
              sublabel="Daily targets & assistant"
              onPress={() => router.dismissTo('/(tabs)/settings')}
              divider
            />
          </Card>
        </View>

        <View>
          <SectionLabel>App</SectionLabel>
          <Card className="py-1">
            <MenuRow
              icon={IconCloud}
              label="Data & sync"
              sublabel="Backup, restore, sync now"
              onPress={() => router.push('/account/data')}
            />
            <MenuRow
              icon={IconInfo}
              label="About"
              sublabel="Version & legal"
              onPress={() => router.push('/account/about')}
              divider
            />
          </Card>
        </View>

        <Button
          label="Sign out"
          onPress={onSignOut}
          variant="danger"
          className="py-[10px] rounded-xl mt-1"
          textClassName="text-[13px]"
        />

        <Text className="font-body text-center text-[12px] text-ink3 mt-1">
          NutriCraft · local-first + cloud sync
        </Text>
      </ScrollView>
    </View>
  );
}
