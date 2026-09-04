import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { eq, isNull, or } from 'drizzle-orm';
import { db, deviceId } from '@/db/client';
import { dailyLogs, foodItems, mealItems, meals, settings } from '@/db/schema';
import { requireUserId } from '@/lib/currentUser';
import { todayISO } from '@/lib/format';

const BACKUP_VERSION = 1;

interface BackupShape {
  version: number;
  exportedAt: string;
  foodItems: unknown[];
  meals: unknown[];
  mealItems: unknown[];
  dailyLogs: unknown[];
  settings: unknown[];
}

/**
 * Serialize the signed-in user's data (full fidelity, including soft-deleted rows).
 * Foods include the shared catalog (`user_id IS NULL`) plus the user's custom foods.
 */
export async function exportDataJson(): Promise<string> {
  const uid = requireUserId();
  const [f, m, mi, dl, s] = await Promise.all([
    db
      .select()
      .from(foodItems)
      .where(or(isNull(foodItems.userId), eq(foodItems.userId, uid))),
    db.select().from(meals).where(eq(meals.userId, uid)),
    db.select().from(mealItems).where(eq(mealItems.userId, uid)),
    db.select().from(dailyLogs).where(eq(dailyLogs.userId, uid)),
    db.select().from(settings).where(eq(settings.id, uid)),
  ]);
  const payload: BackupShape = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    foodItems: f,
    meals: m,
    mealItems: mi,
    dailyLogs: dl,
    settings: s,
  };
  return JSON.stringify(payload, null, 2);
}

/** Write a backup file to the document dir and open the share sheet. */
export async function shareBackup(): Promise<string> {
  const json = await exportDataJson();
  const file = new File(Paths.document, `nutricraft-${deviceId}-backup-${todayISO()}.json`);
  if (file.exists) file.delete();
  file.create();
  file.write(json);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      dialogTitle: 'Export NutriCraft data',
    });
  }
  return file.uri;
}

/**
 * Let the user pick a backup JSON and merge it in.
 * Existing rows (same id) are left untouched (onConflictDoNothing); settings are
 * overwritten. Returns counts, or null if the picker was cancelled.
 */
export async function importBackup(): Promise<
  { foods: number; meals: number; mealItems: number; logs: number } | null
> {
  const res = await DocumentPicker.getDocumentAsync({
    type: 'application/json',
    copyToCacheDirectory: true,
  });
  if (res.canceled || !res.assets?.length) return null;

  const file = new File(res.assets[0].uri);
  const raw = await file.text();
  const data = JSON.parse(raw) as Partial<BackupShape>;

  const foods = (data.foodItems ?? []) as (typeof foodItems.$inferInsert)[];
  const ml = (data.meals ?? []) as (typeof meals.$inferInsert)[];
  const mi = (data.mealItems ?? []) as (typeof mealItems.$inferInsert)[];
  const logs = (data.dailyLogs ?? []) as (typeof dailyLogs.$inferInsert)[];
  const st = (data.settings ?? []) as (typeof settings.$inferInsert)[];

  // Insert in dependency order so foreign keys resolve.
  if (foods.length) await db.insert(foodItems).values(foods).onConflictDoNothing();
  if (ml.length) await db.insert(meals).values(ml).onConflictDoNothing();
  if (mi.length) await db.insert(mealItems).values(mi).onConflictDoNothing();
  if (logs.length) await db.insert(dailyLogs).values(logs).onConflictDoNothing();
  for (const row of st) {
    await db.insert(settings).values(row).onConflictDoUpdate({
      target: settings.id,
      set: row,
    });
  }

  return {
    foods: foods.length,
    meals: ml.length,
    mealItems: mi.length,
    logs: logs.length,
  };
}
