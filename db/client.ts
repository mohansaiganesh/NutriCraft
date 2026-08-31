import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';
import { File, Paths } from 'expo-file-system';
import * as schema from './schema';
import { getUserId } from '@/lib/user';

// Per-install id (resolved before the DB opens) namespaces the DB and backup files.
export const userId = getUserId();
const dbName = `nutricraft-${userId}.db`;

// One-time: retain data from the pre-rename database file (+ its WAL/SHM sidecars).
// expo-sqlite stores DBs under `${Paths.document}/SQLite/`.
(function migrateLegacyDb() {
  for (const suffix of ['', '-wal', '-shm']) {
    const legacy = new File(Paths.document, 'SQLite', `food_tracker.db${suffix}`);
    const target = new File(Paths.document, 'SQLite', `${dbName}${suffix}`);
    if (legacy.exists && !target.exists) {
      try {
        legacy.move(target);
      } catch {
        // Best-effort — a missing sidecar or partial move just means SQLite rebuilds it.
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
