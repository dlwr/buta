import { SCHEMA_STATEMENTS } from "./schema";
import type { FeedbinEntry, FeedbinTagging } from "../feedbin/types";

export async function initSchema(db: D1Database): Promise<void> {
  for (const stmt of SCHEMA_STATEMENTS) {
    await db.exec(stmt.replace(/\s+/g, " ").trim());
  }
}

export async function upsertTaggings(
  db: D1Database, taggings: FeedbinTagging[],
): Promise<void> {
  await db.prepare("DELETE FROM taggings").run();
  if (taggings.length === 0) return;
  const stmt = db.prepare("INSERT INTO taggings (id, feed_id, name) VALUES (?, ?, ?)");
  await db.batch(taggings.map((t) => stmt.bind(t.id, t.feed_id, t.name)));
}

export async function upsertEntries(
  db: D1Database, entries: FeedbinEntry[], syncedAt: string,
): Promise<void> {
  if (entries.length === 0) return;
  const stmt = db.prepare(
    `INSERT INTO entries
       (id, feed_id, title, url, author, summary, content, published, created_at, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       feed_id=excluded.feed_id, title=excluded.title, url=excluded.url,
       author=excluded.author, summary=excluded.summary, content=excluded.content,
       published=excluded.published, created_at=excluded.created_at,
       synced_at=excluded.synced_at`,
  );
  await db.batch(entries.map((e) => stmt.bind(
    e.id, e.feed_id, e.title, e.url, e.author, e.summary, e.content,
    e.published, e.created_at, syncedAt,
  )));
}

async function setFlagFromIds(
  db: D1Database, column: "is_unread" | "is_starred", ids: number[],
): Promise<void> {
  await db.prepare(`UPDATE entries SET ${column} = 0`).run();
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(",");
  await db.prepare(
    `UPDATE entries SET ${column} = 1 WHERE id IN (${placeholders})`,
  ).bind(...ids).run();
}

export async function setUnreadFlags(db: D1Database, unreadIds: number[]): Promise<void> {
  await setFlagFromIds(db, "is_unread", unreadIds);
}

export async function setStarredFlags(db: D1Database, starredIds: number[]): Promise<void> {
  await setFlagFromIds(db, "is_starred", starredIds);
}

export async function getTrackedEntryIds(db: D1Database): Promise<Set<number>> {
  const { results } = await db.prepare("SELECT id FROM entries").all<{ id: number }>();
  return new Set(results.map((r) => r.id));
}
