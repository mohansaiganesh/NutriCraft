import { File, Paths } from 'expo-file-system';
import { newId } from '@/lib/id';

/**
 * Resolve a stable per-install `userId`, generated once and persisted OUTSIDE SQLite
 * (a small JSON file in the document dir) so it is readable synchronously *before*
 * `db/client.ts` opens the database — the DB file is named `nutricraft-<userId>.db`,
 * so the id must exist before the DB does. All calls here are synchronous.
 */
export function getUserId(): string {
  const file = new File(Paths.document, 'nutricraft-user.json');
  if (file.exists) {
    try {
      const parsed = JSON.parse(file.textSync());
      if (parsed?.userId) return parsed.userId as string;
    } catch {
      // Corrupt/unreadable — fall through and regenerate.
    }
  }
  const userId = newId();
  file.create();
  file.write(JSON.stringify({ userId }));
  return userId;
}
