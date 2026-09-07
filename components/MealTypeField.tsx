// Scenario: A meal-prepper assigning a saved meal to a slot in their day — wants a compact,
// tap-to-open list of Breakfast/Lunch/Dinner/Snack that drops right under the field.
import { useRef, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { MEAL_TYPES, mealLabel, type MealType } from '@/constants/meals';
import { IconCheck, IconChevronDown, MealIcon } from '@/components/icons';

type Anchor = { x: number; y: number; width: number; height: number };

export function MealTypeField({
  value,
  onChange,
  className = '',
}: {
  value: MealType;
  onChange: (t: MealType) => void;
  className?: string;
}) {
  const ref = useRef<View>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const current = MEAL_TYPES.find((m) => m.key === value) ?? MEAL_TYPES[0];

  const open = () => {
    ref.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
    });
  };

  const MENU_WIDTH = 190;

  return (
    <>
      <Pressable
        ref={ref}
        onPress={open}
        className={`flex-row items-center justify-center rounded-2xl border border-[#DCE5D4] bg-card px-2 py-[9px] active:opacity-80 ${className}`}
        style={{ gap: 6 }}
      >
        <MealIcon name={current.icon} size={16} color={current.tint} />
        <Text className="font-body-sb text-[13.5px] text-ink">{mealLabel(value)}</Text>
        <IconChevronDown size={14} color="#5B6B5E" />
      </Pressable>

      <Modal visible={!!anchor} transparent animationType="fade" onRequestClose={() => setAnchor(null)}>
        <Pressable className="flex-1" onPress={() => setAnchor(null)}>
          {anchor ? (
            <View
              className="absolute bg-paper rounded-2xl border border-hair py-1"
              style={{
                top: anchor.y + anchor.height + 6,
                left: Math.max(8, anchor.x + anchor.width - MENU_WIDTH),
                width: MENU_WIDTH,
                shadowColor: '#14281e',
                shadowOpacity: 0.14,
                shadowRadius: 18,
                shadowOffset: { width: 0, height: 10 },
                elevation: 8,
              }}
            >
              {MEAL_TYPES.map((m) => {
                const active = m.key === value;
                return (
                  <Pressable
                    key={m.key}
                    onPress={() => {
                      onChange(m.key);
                      setAnchor(null);
                    }}
                    className="flex-row items-center px-3 py-[11px] active:opacity-70"
                    style={{ gap: 10 }}
                  >
                    <View
                      className="w-[26px] h-[26px] rounded-lg items-center justify-center"
                      style={{ backgroundColor: m.tintBg }}
                    >
                      <MealIcon name={m.icon} size={15} color={m.tint} />
                    </View>
                    <Text className={`flex-1 text-[14px] ${active ? 'text-brand font-body-b' : 'text-ink font-body-sb'}`}>
                      {m.label}
                    </Text>
                    {active ? <IconCheck size={16} color="#2F9E44" /> : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </Pressable>
      </Modal>
    </>
  );
}
