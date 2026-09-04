import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';
import * as schema from './schema';
import { getUserId } from '@/lib/user';

// Per-install device id — used for backup file naming. NOT the data owner: data is
// scoped by the `user_id` column (the Supabase auth id) at query time.
export const deviceId = getUserId();

// The local DB is a single fixed file shared by every account on this device
// (rows are partitioned by `user_id`), so it can open before auth resolves.
const dbName = 'nutricraft.db';

// enableChangeListener powers Drizzle's useLiveQuery so screens update reactively.
export const sqlite = openDatabaseSync(dbName, {
  enableChangeListener: true,
});

// Enforce foreign keys (off by default in SQLite).
sqlite.execSync('PRAGMA foreign_keys = ON;');

export const db = drizzle(sqlite, { schema });

export type DB = typeof db;
export { schema };
