import type { FoodItem } from '@/db/schema';

/**
 * One-slot hand-off for a food picked on the `pick-food` screen back to the meal
 * builder. `pick-food` is a separate pushed route and can't return a value, so it
 * stashes the selection here and the builder drains it on focus.
 */
let pending: { food: FoodItem; grams: number } | null = null;

export const setPendingPick = (p: { food: FoodItem; grams: number }) => {
  pending = p;
};

export const takePendingPick = () => {
  const p = pending;
  pending = null;
  return p;
};
