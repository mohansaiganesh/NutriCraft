import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { fmt, num } from '@/lib/format';
import { IconMinus, IconPlus } from '@/components/icons';

const STEP = 5;

// Inline quantity control on each logged/meal item: [-] <tap-to-edit grams> [+]
export function GramStepper({ grams, onChange }: { grams: number; onChange: (g: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');

  const commit = () => {
    const n = num(text);
    if (n > 0) onChange(n); // ignore empty / 0 / invalid -> revert to current
    setEditing(false);
  };
  const bump = (delta: number) => onChange(Math.max(STEP, grams + delta));

  return (
    <View className="flex-row items-center -mr-[13px]" style={{ gap: 4 }}>
      <Pressable
        onPress={() => bump(-STEP)}
        className="w-[22px] h-[22px] rounded-full bg-card border border-hair items-center justify-center active:opacity-80"
      >
        <IconMinus size={13} color="#1B7A32" />
      </Pressable>

      {editing ? (
        <TextInput
          autoFocus
          value={text}
          onChangeText={setText}
          onBlur={commit}
          onSubmitEditing={commit}
          keyboardType="decimal-pad"
          className="font-body-sb text-ink text-[13px] text-center min-w-[34px] px-[2px] py-[1px] border-b border-hair"
        />
      ) : (
        <Pressable
          onPress={() => {
            setText(fmt(grams));
            setEditing(true);
          }}
          className="min-w-[34px] items-center py-[3px]"
        >
          <Text className="font-body-sb text-ink text-[13px]">{fmt(grams)} g</Text>
        </Pressable>
      )}

      <Pressable
        onPress={() => bump(STEP)}
        className="w-[22px] h-[22px] rounded-full bg-card border border-hair items-center justify-center active:opacity-80"
      >
        <IconPlus size={13} color="#1B7A32" />
      </Pressable>
    </View>
  );
}
