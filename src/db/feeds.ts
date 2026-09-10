export interface FeedRow {
  id: number; feed_url: string; site_url: string | null; title: string; created_at: string;
  etag: string | null; last_modified: string | null; last_fetched_at: string | null;
  error_count: number; last_error: string | null;
}

export interface NewFeed { feedUrl: string; siteUrl: string | null; title: string; createdAt: string }

export async function listFeeds(db: D1Database): Promise<FeedRow[]> {
  const { results } = await db.prepare("SELECT * FROM feeds ORDER BY id").all<FeedRow>();
  return results;
}

export async function getFeed(db: D1Database, id: number): Promise<FeedRow | null> {
  return db.prepare("SELECT * FROM feeds WHERE id = ?").bind(id).first<FeedRow>();
}

export async function findFeedByUrl(db: D1Database, feedUrl: string): Promise<FeedRow | null> {
  return db.prepare("SELECT * FROM feeds WHERE feed_url = ?").bind(feedUrl).first<FeedRow>();
}

export async function insertFeed(db: D1Database, input: NewFeed): Promise<FeedRow> {
  const row = await db.prepare(
    "INSERT INTO feeds (feed_url, site_url, title, created_at) VALUES (?, ?, ?, ?) RETURNING *",
  ).bind(input.feedUrl, input.siteUrl, input.title, input.createdAt).first<FeedRow>();
  if (!row) throw new Error("insertFeed returned no row");
  return row;
}

export async function renameFeed(db: D1Database, id: number, title: string): Promise<boolean> {
  const r = await db.prepare("UPDATE feeds SET title = ? WHERE id = ?").bind(title, id).run();
  return r.meta.changes > 0;
}

export async function deleteFeed(db: D1Database, id: number): Promise<boolean> {
  const r = await db.prepare("DELETE FROM feeds WHERE id = ?").bind(id).run();
  return r.meta.changes > 0;
}

export async function recordFetchSuccess(
  db: D1Database, id: number, meta: { etag: string | null; lastModified: string | null; fetchedAt: string },
): Promise<void> {
  await db.prepare(
    "UPDATE feeds SET etag = ?, last_modified = ?, last_fetched_at = ?, error_count = 0, last_error = NULL WHERE id = ?",
  ).bind(meta.etag, meta.lastModified, meta.fetchedAt, id).run();
}

export async function recordFetchFailure(
  db: D1Database, id: number, meta: { message: string; fetchedAt: string },
): Promise<void> {
  await db.prepare(
    "UPDATE feeds SET last_fetched_at = ?, error_count = error_count + 1, last_error = ? WHERE id = ?",
  ).bind(meta.fetchedAt, meta.message, id).run();
}
