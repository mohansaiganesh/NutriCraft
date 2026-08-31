import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import migrations from '../drizzle/migrations';
import { db } from './client';

/** Applies pending Drizzle migrations at app startup. */
export function useAppMigrations() {
  return useMigrations(db, migrations);
}
