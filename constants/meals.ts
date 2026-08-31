import type { MealIconName } from '@/components/icons';

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export const MEAL_TYPES: {
  key: MealType;
  label: string;
  icon: MealIconName;
  tint: string;
  tintBg: string;
}[] = [
  { key: 'breakfast', label: 'Breakfast', icon: 'sunrise', tint: '#E8890C', tintBg: '#FFF3E0' },
  { key: 'lunch', label: 'Lunch', icon: 'sun', tint: '#D9820C', tintBg: '#FEF3C7' },
  { key: 'dinner', label: 'Dinner', icon: 'moon', tint: '#6D48D6', tintBg: '#EDE9FE' },
  { key: 'snack', label: 'Snack', icon: 'apple', tint: '#1B7A32', tintBg: '#DCFCE7' },
];

export const mealLabel = (key: string): string =>
  MEAL_TYPES.find((m) => m.key === key)?.label ?? key;
