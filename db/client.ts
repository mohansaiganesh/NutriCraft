import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';
import { File, Paths } from 'expo-file-system';
import * as schema from './schema';
import { getUserId } from '@/lib/user';

// Per-install device id — kept for backup file naming and to locate any legacy,
// account-namespaced DB file from before multi-user. NOT the data owner anymore:
// data is scoped by the `user_id` column (the Supabase auth id) at query time.
export const deviceId = getUserId();

// The local DB is now a single fixed file shared by every account on this device
// (rows are partitioned by `user_id`), so it can open before auth resolves.
const dbName = 'nutricraft.db';

// One-time: fold any older DB file into the fixed-name DB (+ its WAL/SHM sidecars).
// Handles both the very old `food_tracker.db` and the per-install
// `nutricraft-<deviceId>.db` used during the single-user era.
// expo-sqlite stores DBs under `${Paths.document}/SQLite/`.
(function migrateLegacyDb() {
  const legacyBases = ['food_tracker.db', `nutricraft-${deviceId}.db`];
  for (const base of legacyBases) {
    for (const suffix of ['', '-wal', '-shm']) {
      const legacy = new File(Paths.document, 'SQLite', `${base}${suffix}`);
      const target = new File(Paths.document, 'SQLite', `${dbName}${suffix}`);
      if (legacy.exists && !target.exists) {
        try {
          legacy.move(target);
        } catch {
          // Best-effort — a missing sidecar or partial move just means SQLite rebuilds it.
        }
      }
    }
  }
})();

// enableChangeListener powers Drizzle's useLiveQuery so screens update reactively.
export const sqlite = openDatabaseSync(dbName, {
  enableChangeListener: true,
});

// Enforce foreign keys (off by default in SQLite).
sqlite.execSync('PRAGMA foreign_keys = ON;');

export const db = drizzle(sqlite, { schema });

export type DB = typeof db;
export { schema };
