import type { Config } from 'drizzle-kit';

// Local-first now (SQLite via expo-sqlite). The schema is written once in
// db/schema.ts so the same definitions can target Postgres later for cloud sync.
export default {
  schema: './db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  driver: 'expo',
} satisfies Config;
