// Scenario: filling in personal details once, calmly — the kind of profile form a real app
// ships, not a wall of inputs. Garden light mode, single-column, generous spacing.
import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { settingsQuery, updateSettings } from '@/db/queries';
import { useSession } from '@/lib/session';
import { Button, Card, DetailHeader, Field, Muted } from '@/components/ui';

/** Trim a field to a stored value: empty string becomes NULL. */
const clean = (s: string): string | null => {
  const t = s.trim();
  return t.length ? t : null;
};

export default function ProfileScreen() {
  const { email } = useSession();
  const { data } = useLiveQuery(settingsQuery());
  const settings = data?.[0];

  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [country, setCountry] = useState('');
  const [phone, setPhone] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [baseline, setBaseline] = useState({ name: '', age: '', country: '', phone: '' });

  useEffect(() => {
    if (settings && !loaded) {
      const snapshot = {
        name: settings.displayName ?? '',
        age: settings.age != null ? String(settings.age) : '',
        country: settings.country ?? '',
        phone: settings.phone ?? '',
      };
      setName(snapshot.name);
      setAge(snapshot.age);
      setCountry(snapshot.country);
      setPhone(snapshot.phone);
      setBaseline(snapshot);
      setLoaded(true);
    }
  }, [settings, loaded]);

  const dirty =
    editing &&
    (name !== baseline.name ||
      age !== baseline.age ||
      country !== baseline.country ||
      phone !== baseline.phone);

  const save = async () => {
    const trimmedAge = age.trim();
    if (trimmedAge && !/^\d{1,3}$/.test(trimmedAge)) {
      Alert.alert('Check your age', 'Age must be a whole number.');
      return;
    }
    await updateSettings({
      displayName: clean(name),
      age: trimmedAge ? Number(trimmedAge) : null,
      country: clean(country),
      phone: clean(phone),
    });
    setBaseline({ name, age, country, phone });
    setEditing(false);
    Alert.alert('Saved', 'Your profile was updated.');
  };

  const cancel = () => {
    setName(baseline.name);
    setAge(baseline.age);
    setCountry(baseline.country);
    setPhone(baseline.phone);
    setEditing(false);
  };

  return (
    <View className="flex-1 bg-paper">
      <DetailHeader title="Profile" />
      <ScrollView contentContainerClassName="px-4 pb-16 gap-[14px]">
        <Card className="gap-3">
          <Field
            label="Name"
            value={name}
            onChangeText={setName}
            editable={editing}
            placeholder="Your name"
            autoCapitalize="words"
          />
          <View className="flex-row gap-3">
            <Field
              label="Age"
              value={age}
              onChangeText={setAge}
              editable={editing}
              keyboardType="number-pad"
              placeholder="—"
              className="w-28"
            />
            <Field
              label="Country"
              value={country}
              onChangeText={setCountry}
              editable={editing}
              placeholder="Country"
              autoCapitalize="words"
              className="flex-1"
            />
          </View>
          <Field
            label="Phone"
            value={phone}
            onChangeText={setPhone}
            editable={editing}
            keyboardType="phone-pad"
            placeholder="Phone number"
          />
          <View>
            <Field label="Email" value={email ?? ''} editable={false} />
            <Muted className="text-[11.5px] text-ink3 mt-[6px] ml-1">
              Your login email. Change it under Security & login.
            </Muted>
          </View>

          {editing ? (
            <View className="flex-row gap-3">
              <Button
                label="Save"
                onPress={save}
                disabled={!dirty}
                className="flex-1 py-[9px] rounded-xl"
                textClassName="text-[13px]"
              />
              <Button
                label="Cancel"
                variant="secondary"
                onPress={cancel}
                className="flex-1 py-[9px] rounded-xl"
                textClassName="text-[13px]"
              />
            </View>
          ) : (
            <Button
              label="Edit profile"
              variant="secondary"
              onPress={() => setEditing(true)}
              className="py-[9px] rounded-xl"
              textClassName="text-[13px]"
            />
          )}
        </Card>

        <Muted className="text-[12px] leading-[17px] text-ink3 px-1">
          Profile details are private to your account and sync across your devices.
        </Muted>
      </ScrollView>
    </View>
  );
}
