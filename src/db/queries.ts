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

// D1/SQLite caps bound parameters per statement (~100), so a single
// `IN (?,?,...)` over thousands of ids fails with "too many SQL variables".
// Chunk the id list and run the reset + set as one atomic batch, so a
// failure never leaves every row reset to 0.
const FLAG_ID_CHUNK = 90;

async function setFlagFromIds(
  db: D1Database, column: "is_unread" | "is_starred", ids: number[],
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    db.prepare(`UPDATE entries SET ${column} = 0`),
  ];
  for (let i = 0; i < ids.length; i += FLAG_ID_CHUNK) {
    const chunk = ids.slice(i, i + FLAG_ID_CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    statements.push(
      db.prepare(`UPDATE entries SET ${column} = 1 WHERE id IN (${placeholders})`).bind(...chunk),
    );
  }
  await db.batch(statements);
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
