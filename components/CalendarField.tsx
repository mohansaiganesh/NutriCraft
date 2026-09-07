// Scenario: A meal-prepper picking which upcoming day to log a saved meal onto — wants a quick,
// familiar month calendar, not a wall of arrow taps, and styled to match the Garden theme.
import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { todayISO, dateLabel } from '@/lib/format';
import { IconCalendar, IconChevronLeft, IconChevronRight } from '@/components/icons';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Build the 6×7 grid of day numbers (null = padding) for a given month. */
function monthCells(year: number, month: number): (number | null)[] {
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function CalendarField({
  value,
  onChange,
  className = '',
  textClassName = 'font-body-sb text-[13.5px]',
}: {
  value: string;
  onChange: (iso: string) => void;
  className?: string;
  textClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [y, mIdx, dSel] = value.split('-').map(Number);
  const [viewYear, setViewYear] = useState(y);
  const [viewMonth, setViewMonth] = useState(mIdx - 1); // 0-based
  const today = todayISO();

  const openPicker = () => {
    // Re-sync the visible month to the current value each time it opens.
    setViewYear(y);
    setViewMonth(mIdx - 1);
    setOpen(true);
  };

  const stepMonth = (delta: number) => {
    const next = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  };

  const pick = (day: number) => {
    onChange(todayISO(new Date(viewYear, viewMonth, day)));
    setOpen(false);
  };

  const cells = monthCells(viewYear, viewMonth);

  return (
    <>
      <Pressable
        onPress={openPicker}
        className={`flex-row items-center justify-center rounded-2xl border border-[#DCE5D4] bg-card px-3 py-[9px] active:opacity-80 ${className}`}
        style={{ gap: 6 }}
      >
        <IconCalendar size={16} color="#3A4A3D" />
        <Text numberOfLines={1} className={`text-ink ${textClassName}`}>{dateLabel(value, true)}</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1 bg-black/40 items-center justify-center px-6" onPress={() => setOpen(false)}>
          <Pressable onPress={() => {}} className="w-full max-w-[340px] bg-paper rounded-3xl p-4">
            {/* Month header */}
            <View className="flex-row items-center justify-between mb-3">
              <Pressable
                onPress={() => stepMonth(-1)}
                className="w-[38px] h-[38px] rounded-full bg-card border border-hair items-center justify-center active:opacity-80"
              >
                <IconChevronLeft size={18} color="#3A4A3D" />
              </Pressable>
              <Text className="font-display text-[18px] text-ink">
                {MONTHS[viewMonth]} {viewYear}
              </Text>
              <Pressable
                onPress={() => stepMonth(1)}
                className="w-[38px] h-[38px] rounded-full bg-card border border-hair items-center justify-center active:opacity-80"
              >
                <IconChevronRight size={18} color="#3A4A3D" />
              </Pressable>
            </View>

            {/* Weekday header */}
            <View className="flex-row mb-1">
              {WEEKDAYS.map((w, i) => (
                <View key={i} className="flex-1 items-center py-1">
                  <Text className="font-body-b text-[11px] text-ink3">{w}</Text>
                </View>
              ))}
            </View>

            {/* Day grid */}
            <View className="flex-row flex-wrap">
              {cells.map((day, i) => {
                if (day == null) return <View key={i} className="w-[14.28%] aspect-square" />;
                const iso = todayISO(new Date(viewYear, viewMonth, day));
                const isSelected = iso === value;
                const isToday = iso === today;
                return (
                  <View key={i} className="w-[14.28%] aspect-square items-center justify-center p-[2px]">
                    <Pressable
                      onPress={() => pick(day)}
                      className={`w-full h-full rounded-full items-center justify-center active:opacity-70 ${
                        isSelected ? 'bg-brand' : isToday ? 'border border-brand' : ''
                      }`}
                    >
                      <Text
                        className={`text-[14px] ${
                          isSelected ? 'text-white font-body-b' : isToday ? 'text-brand font-body-b' : 'text-ink font-body-sb'
                        }`}
                      >
                        {day}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>

            {/* Today shortcut */}
            <Pressable
              onPress={() => {
                onChange(today);
                setOpen(false);
              }}
              className="mt-2 py-[10px] items-center active:opacity-70"
            >
              <Text className="font-body-b text-[14px] text-brand">Today</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
