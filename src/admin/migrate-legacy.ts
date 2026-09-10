import { findEntryIdsByUrls } from "../db/entries";
import { addMarks, removeMarks } from "../db/marks";

export interface LegacyMigrationResult { matched: number; markedRead: number; starred: number }

export async function migrateLegacyState(db: D1Database): Promise<LegacyMigrationResult> {
  const { results } = await db.prepare(
    "SELECT url, is_unread, is_starred FROM legacy_entries WHERE url IS NOT NULL AND (is_unread = 0 OR is_starred = 1)",
  ).all<{ url: string; is_unread: number; is_starred: number }>();
  const ids = await findEntryIdsByUrls(db, results.map((r) => r.url));
  const read: number[] = [];
  const starred: number[] = [];
  for (const r of results) {
    const id = ids.get(r.url);
    if (id === undefined) continue;
    if (r.is_unread === 0) read.push(id);
    if (r.is_starred === 1) starred.push(id);
  }
  await removeMarks(db, "unread_entries", read);
  await addMarks(db, "starred_entries", starred);
  return { matched: ids.size, markedRead: read.length, starred: starred.length };
}
