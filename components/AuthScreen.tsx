// Scenario: someone reopening NutriCraft on a brand-new phone in a bright kitchen,
// wanting their foods and logs to just be there — a calm, single-focus sign-in on the
// app's garden-paper ground, not a corporate login wall.
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Field } from '@/components/ui';
import { useSession } from '@/lib/session';

type Mode = 'signin' | 'signup';

export function AuthScreen() {
  const { signIn, signUp } = useSession();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isSignup = mode === 'signup';

  const submit = async () => {
    setError(null);
    setNotice(null);
    const mail = email.trim();
    if (!mail || !password) {
      setError('Enter your email and password.');
      return;
    }
    if (isSignup && password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setBusy(true);
    try {
      const res = isSignup ? await signUp(mail, password) : await signIn(mail, password);
      if (res.error) {
        setError(res.error);
      } else if (isSignup) {
        // Depending on the project's email-confirmation setting, sign-up may not
        // create an active session immediately.
        setNotice('Account created. If email confirmation is on, check your inbox, then sign in.');
        setMode('signin');
        setPassword('');
      }
      // On successful sign-in the SessionProvider swaps this screen for the app.
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-paper"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerClassName="flex-grow justify-center px-5"
        contentContainerStyle={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="mb-6">
          <Text className="font-body-b text-[12px] tracking-wide text-ink3 mb-1 uppercase">
            NutriCraft
          </Text>
          <Text className="font-display text-[32px] leading-[36px] text-ink">
            {isSignup ? 'Create your account' : 'Welcome back'}
          </Text>
          <Text className="font-body text-[13.5px] text-ink2 mt-2 leading-5">
            {isSignup
              ? 'Your foods, meals and logs sync across every device and survive a reinstall.'
              : 'Sign in to sync your foods, meals and logs across your devices.'}
          </Text>
        </View>

        <Card className="gap-3">
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            placeholder="you@example.com"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            textContentType={isSignup ? 'newPassword' : 'password'}
            placeholder={isSignup ? 'At least 6 characters' : 'Your password'}
          />

          {error ? (
            <Text className="font-body-sb text-[13px] text-over">{error}</Text>
          ) : null}
          {notice ? (
            <Text className="font-body-sb text-[13px] text-brand-ink">{notice}</Text>
          ) : null}

          {busy ? (
            <View className="py-[14px] items-center">
              <ActivityIndicator color="#2F9E44" />
            </View>
          ) : (
            <Button label={isSignup ? 'Create account' : 'Sign in'} onPress={submit} />
          )}
        </Card>

        <Pressable
          className="mt-5 items-center active:opacity-60"
          onPress={() => {
            setMode(isSignup ? 'signin' : 'signup');
            setError(null);
            setNotice(null);
          }}
          disabled={busy}
        >
          <Text className="font-body text-[13.5px] text-ink2">
            {isSignup ? 'Already have an account? ' : "Don't have an account? "}
            <Text className="font-body-b text-brand-ink">
              {isSignup ? 'Sign in' : 'Create one'}
            </Text>
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
