import { ReactNode } from 'react';
import {
  Pressable,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { IconChevronLeft, IconPlus } from './icons';

/** Soft card elevation shared by every raised surface. */
export const cardShadow = {
  shadowColor: '#14281e',
  shadowOpacity: 0.06,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 8 },
  elevation: 2,
} as const;

export function Card({ className = '', style, ...props }: ViewProps & { className?: string }) {
  return (
    <View
      className={`rounded-3xl bg-card border border-hair p-[18px] ${className}`}
      style={[cardShadow, style]}
      {...props}
    />
  );
}

/** Big in-screen header (kicker + display title) — replaces the old sky nav bars. */
export function AppHeader({
  title,
  kicker,
  right,
  subtitle,
}: {
  title: string;
  kicker?: string;
  right?: ReactNode;
  subtitle?: string;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top + 8 }} className="mb-4">
      <View className="flex-row items-end justify-between">
        <View className="flex-1">
          {kicker ? (
            <Text className="font-body-b text-[12px] tracking-wide text-ink3 mb-1 uppercase">
              {kicker}
            </Text>
          ) : null}
          <Text className="font-display text-[32px] leading-[34px] text-ink">{title}</Text>
        </View>
        {right}
      </View>
      {subtitle ? <Text className="font-body text-[13.5px] text-ink2 mt-2">{subtitle}</Text> : null}
    </View>
  );
}

/** In-screen header for detail/form screens — back button + title, safe-area aware. */
export function DetailHeader({ title, right, onBack }: { title: string; right?: ReactNode; onBack?: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{ paddingTop: insets.top + 6 }}
      className="px-4 pb-3 bg-paper flex-row items-center"
    >
      <Pressable
        onPress={onBack ?? (() => router.back())}
        className="w-10 h-10 -ml-2 rounded-full items-center justify-center active:opacity-60"
        hitSlop={8}
      >
        <IconChevronLeft size={24} color="#16241A" />
      </Pressable>
      <Text className="font-display text-[22px] text-ink flex-1 ml-1" numberOfLines={1}>
        {title}
      </Text>
      {right}
    </View>
  );
}

export function ScreenTitle({ children }: { children: ReactNode }) {
  return <Text className="font-display text-[28px] text-ink">{children}</Text>;
}

export function Muted({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <Text className={`font-body text-ink2 ${className}`}>{children}</Text>;
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
  const base = 'rounded-2xl px-4 py-[14px] items-center active:opacity-90';
  const styles =
    variant === 'primary'
      ? 'bg-brand'
      : variant === 'danger'
        ? 'bg-[#FDECEC] border border-[#F6CDCD]'
        : 'bg-[#EEF3EA] border border-[#DCEAD4]';
  const textStyles =
    variant === 'primary'
      ? 'text-white font-body-b'
      : variant === 'danger'
        ? 'text-over font-body-b'
        : 'text-brand-ink font-body-b';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`${base} ${styles} ${disabled ? 'opacity-40' : ''} ${className}`}
      style={variant === 'primary' ? primaryShadow : undefined}
    >
      <Text className={`${textStyles} text-[15px]`}>{label}</Text>
    </Pressable>
  );
}

const primaryShadow = {
  shadowColor: '#2F9E44',
  shadowOpacity: 0.3,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 8 },
  elevation: 3,
} as const;

export function Field({
  label,
  className = '',
  ...props
}: TextInputProps & { label?: string; className?: string }) {
  return (
    <View className={className}>
      {label ? (
        <Text className="font-body-sb text-[12.5px] text-ink2 mb-[6px]">{label}</Text>
      ) : null}
      <TextInput
        placeholderTextColor="#9AA79B"
        className="rounded-2xl border border-[#DCE5D4] bg-card px-[14px] py-[13px] text-[15px] font-body-md text-ink"
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
      className={`rounded-full px-[14px] py-[9px] mr-2 mb-2 border active:opacity-80 ${
        active ? 'bg-brand border-brand' : 'bg-card border-[#DCE5D4]'
      }`}
      style={active ? chipShadow : undefined}
    >
      <Text
        className={`text-[13.5px] ${active ? 'text-white font-body-b' : 'text-[#3A4A3D] font-body-sb'}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const chipShadow = {
  shadowColor: '#2F9E44',
  shadowOpacity: 0.24,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 6 },
  elevation: 2,
} as const;

export function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View className="items-center py-10 px-6 rounded-3xl border border-dashed border-[#CFE0C6] bg-[#FFFFFF80] mt-1">
      <View className="w-[52px] h-[52px] rounded-2xl bg-[#EAF7EC] items-center justify-center mb-3">
        <IconPlus size={26} color="#2F9E44" />
      </View>
      <Text className="font-display-sb text-[17px] text-ink text-center">{title}</Text>
      {subtitle ? (
        <Text className="font-body text-[13px] text-ink2 text-center mt-1 max-w-[260px]">
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

/** Tinted inline "+ Add food" button used inside meal/day cards. */
export function AddFoodButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="mt-3 py-[11px] flex-row items-center justify-center gap-[7px] rounded-2xl bg-[#EEF6EC] border border-[#DCEAD4] active:opacity-80"
    >
      <IconPlus size={16} color="#1B7A32" />
      <Text className="text-[#1B7A32] font-body-b text-[14px]">Add food</Text>
    </Pressable>
  );
}

/** Floating action button, bottom-right. */
export function Fab({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="absolute bottom-8 right-5 w-[60px] h-[60px] rounded-full bg-brand items-center justify-center active:opacity-90"
      style={fabShadow}
    >
      <IconPlus size={26} color="#fff" />
    </Pressable>
  );
}

const fabShadow = {
  shadowColor: '#2F9E44',
  shadowOpacity: 0.42,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 12 },
  elevation: 6,
} as const;
