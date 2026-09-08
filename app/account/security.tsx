// Scenario: a security-conscious user updating their password on a shared laptop — clear,
// deliberate forms with explicit confirmation, and a plainly marked danger zone.
import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native';
import { useSession } from '@/lib/session';
import { Button, Card, DetailHeader, Field, Muted } from '@/components/ui';

function CardTitle({ children }: { children: React.ReactNode }) {
  return <Text className="font-display-sb text-[15px] text-ink mb-1">{children}</Text>;
}

/** Change-password form: current + new + confirm, verified server-side. */
function ChangePasswordCard() {
  const { changePassword } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setNotice(null);
    if (!current || !next) {
      setError('Enter your current and new password.');
      return;
    }
    if (next.length < 6) {
      setError('New password must be at least 6 characters.');
      return;
    }
    if (next !== confirm) {
      setError('New passwords don’t match.');
      return;
    }
    setBusy(true);
    try {
      const res = await changePassword(current, next);
      if (res.error) {
        setError(res.error);
      } else {
        setNotice('Password updated.');
        setCurrent('');
        setNext('');
        setConfirm('');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="gap-3">
      <CardTitle>Change password</CardTitle>
      <Field
        label="Current password"
        value={current}
        onChangeText={setCurrent}
        editable={!busy}
        secureTextEntry
        autoCapitalize="none"
        textContentType="password"
      />
      <Field
        label="New password"
        value={next}
        onChangeText={setNext}
        editable={!busy}
        secureTextEntry
        autoCapitalize="none"
        textContentType="newPassword"
        placeholder="At least 6 characters"
      />
      <Field
        label="Confirm new password"
        value={confirm}
        onChangeText={setConfirm}
        editable={!busy}
        secureTextEntry
        autoCapitalize="none"
        textContentType="newPassword"
      />
      {error ? <Text className="font-body-sb text-[13px] text-over">{error}</Text> : null}
      {notice ? <Text className="font-body-sb text-[13px] text-brand-ink">{notice}</Text> : null}
      {busy ? (
        <View className="py-[10px] items-center">
          <ActivityIndicator color="#2F9E44" />
        </View>
      ) : (
        <Button
          label="Update password"
          onPress={submit}
          className="py-[9px] rounded-xl"
          textClassName="text-[13px]"
        />
      )}
    </Card>
  );
}

/** Change-email form: shows the current login email + a field for the new one. */
function ChangeEmailCard() {
  const { email, changeEmail } = useSession();
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setNotice(null);
    const mail = next.trim();
    if (!mail || !mail.includes('@')) {
      setError('Enter a valid email address.');
      return;
    }
    if (mail === email) {
      setError('That’s already your email.');
      return;
    }
    setBusy(true);
    try {
      const res = await changeEmail(mail);
      if (res.error) {
        setError(res.error);
      } else {
        setNotice(`Confirmation sent to ${mail}. Open the link there to finish the change.`);
        setNext('');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="gap-3">
      <CardTitle>Change email</CardTitle>
      <Field label="Current email" value={email ?? ''} editable={false} />
      <Field
        label="New email"
        value={next}
        onChangeText={setNext}
        editable={!busy}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        placeholder="you@example.com"
      />
      {error ? <Text className="font-body-sb text-[13px] text-over">{error}</Text> : null}
      {notice ? <Text className="font-body-sb text-[13px] text-brand-ink">{notice}</Text> : null}
      {busy ? (
        <View className="py-[10px] items-center">
          <ActivityIndicator color="#2F9E44" />
        </View>
      ) : (
        <Button
          label="Send confirmation"
          variant="secondary"
          onPress={submit}
          className="py-[9px] rounded-xl"
          textClassName="text-[13px]"
        />
      )}
    </Card>
  );
}

/** Danger zone: re-verify the password, confirm, then permanently delete the account. */
function DeleteAccountCard() {
  const { email, signIn, deleteAccount } = useSession();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      // Re-verify identity before an irreversible action.
      if (email) {
        const check = await signIn(email, password);
        if (check.error) {
          setError('Password is incorrect.');
          return;
        }
      }
      const res = await deleteAccount();
      if (res.error) {
        setError(res.error);
        return;
      }
      // On success `deleteAccount` signs out, which flips session status → the root layout
      // unmounts this whole navigator and shows the login screen. No manual dismissal needed
      // (calling router here would POP_TO_TOP a navigator that no longer exists).
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    if (!password) {
      setError('Enter your password to confirm.');
      return;
    }
    Alert.alert(
      'Delete account?',
      'This permanently deletes your account and all your foods, meals and logs — on this device and in the cloud. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete forever', style: 'destructive', onPress: () => void runDelete() },
      ]
    );
  };

  return (
    <Card className="gap-3 border-[#F6CDCD]">
      <CardTitle>Delete account</CardTitle>
      <Muted className="text-[12.5px] leading-[18px] -mt-1">
        Permanently remove your account and all your data everywhere. Enter your password to
        confirm.
      </Muted>
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        editable={!busy}
        secureTextEntry
        autoCapitalize="none"
        textContentType="password"
      />
      {error ? <Text className="font-body-sb text-[13px] text-over">{error}</Text> : null}
      {busy ? (
        <View className="py-[10px] items-center">
          <ActivityIndicator color="#E03131" />
        </View>
      ) : (
        <Button
          label="Delete my account"
          variant="danger"
          onPress={confirm}
          className="py-[9px] rounded-xl"
          textClassName="text-[13px]"
        />
      )}
    </Card>
  );
}

export default function SecurityScreen() {
  return (
    <View className="flex-1 bg-paper">
      <DetailHeader title="Security & login" />
      <ScrollView contentContainerClassName="px-4 pb-16 gap-[14px]">
        <ChangePasswordCard />
        <ChangeEmailCard />
        <DeleteAccountCard />
      </ScrollView>
    </View>
  );
}
