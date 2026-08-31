import { ReactNode } from 'react';
import {
  Pressable,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewProps,
} from 'react-native';

export function Card({ className = '', ...props }: ViewProps & { className?: string }) {
  return (
    <View
      className={`rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 p-4 ${className}`}
      {...props}
    />
  );
}

export function ScreenTitle({ children }: { children: ReactNode }) {
  return (
    <Text className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
      {children}
    </Text>
  );
}

export function Muted({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <Text className={`text-neutral-500 dark:text-neutral-400 ${className}`}>{children}</Text>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  className = '',
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  className?: string;
}) {
  const base = 'rounded-xl px-4 py-3 items-center active:opacity-80';
  const styles =
    variant === 'primary'
      ? 'bg-sky-600'
      : variant === 'danger'
        ? 'bg-red-50 dark:bg-red-950 border border-red-300 dark:border-red-800'
        : 'bg-neutral-100 dark:bg-neutral-800';
  const textStyles =
    variant === 'primary'
      ? 'text-white font-semibold'
      : variant === 'danger'
        ? 'text-red-600 dark:text-red-400 font-semibold'
        : 'text-neutral-800 dark:text-neutral-100 font-semibold';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`${base} ${styles} ${disabled ? 'opacity-40' : ''} ${className}`}
    >
      <Text className={textStyles}>{label}</Text>
    </Pressable>
  );
}

export function Field({
  label,
  className = '',
  ...props
}: TextInputProps & { label?: string; className?: string }) {
  return (
    <View className={className}>
      {label ? (
        <Text className="text-sm font-medium text-neutral-600 dark:text-neutral-300 mb-1">
          {label}
        </Text>
      ) : null}
      <TextInput
        placeholderTextColor="#9ca3af"
        className="rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-3 text-neutral-900 dark:text-neutral-50"
        {...props}
      />
    </View>
  );
}

export function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-full px-3 py-2 mr-2 mb-2 border ${
        active
          ? 'bg-sky-600 border-sky-600'
          : 'bg-transparent border-neutral-300 dark:border-neutral-700'
      }`}
    >
      <Text className={active ? 'text-white font-medium' : 'text-neutral-700 dark:text-neutral-300'}>
        {label}
      </Text>
    </Pressable>
  );
}

export function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View className="items-center py-12 px-6">
      <Text className="text-lg font-semibold text-neutral-700 dark:text-neutral-200 text-center">
        {title}
      </Text>
      {subtitle ? <Muted className="text-center mt-1">{subtitle}</Muted> : null}
    </View>
  );
}

/** Floating action button, bottom-right. */
export function Fab({ onPress, label = '+' }: { onPress: () => void; label?: string }) {
  return (
    <Pressable
      onPress={onPress}
      className="absolute bottom-6 right-6 w-14 h-14 rounded-full bg-sky-600 items-center justify-center shadow-lg active:opacity-80"
    >
      <Text className="text-white text-3xl leading-9">{label}</Text>
    </Pressable>
  );
}
