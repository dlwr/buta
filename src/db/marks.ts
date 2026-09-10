import { chunk } from "./entries";

export type MarkTable = "unread_entries" | "starred_entries";

export async function listMarked(db: D1Database, table: MarkTable): Promise<number[]> {
  const { results } = await db.prepare(`SELECT entry_id FROM ${table} ORDER BY entry_id`).all<{ entry_id: number }>();
  return results.map((r) => r.entry_id);
}

export async function addMarks(db: D1Database, table: MarkTable, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await db.batch(chunk(ids).map((part) => db.prepare(
    `INSERT OR IGNORE INTO ${table} (entry_id)
       SELECT id FROM entries WHERE id IN (${part.map(() => "?").join(",")})`,
  ).bind(...part)));
}

export async function removeMarks(db: D1Database, table: MarkTable, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await db.batch(chunk(ids).map((part) => db.prepare(
    `DELETE FROM ${table} WHERE entry_id IN (${part.map(() => "?").join(",")})`,
  ).bind(...part)));
}
