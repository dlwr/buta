export interface EntryRow {
  id: number; feed_id: number; title: string | null; url: string | null; author: string | null;
  summary: string | null; content: string | null; published: string; created_at: string;
}

export interface NewEntry {
  feedId: number; dedupKey: string; title: string | null; url: string | null; author: string | null;
  summary: string | null; content: string | null; published: string; createdAt: string;
}

export interface EntryQuery {
  page: number; perPage: number; since?: string; feedId?: number; ids?: number[];
  onlyUnread?: boolean; onlyStarred?: boolean;
}

// D1 caps bound parameters per statement (~100), so id lists are chunked.
export const ID_CHUNK = 90;

export function chunk<T>(items: T[], size = ID_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function insertNewEntries(db: D1Database, entries: NewEntry[]): Promise<number[]> {
  if (entries.length === 0) return [];
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO entries
       (feed_id, dedup_key, title, url, author, summary, content, published, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  );
  const results = await db.batch<{ id: number }>(entries.map((e) => stmt.bind(
    e.feedId, e.dedupKey, e.title, e.url, e.author, e.summary, e.content, e.published, e.createdAt,
  )));
  return results.flatMap((r) => r.results.map((row) => row.id));
}

export async function getEntry(db: D1Database, id: number): Promise<EntryRow | null> {
  return db.prepare("SELECT * FROM entries WHERE id = ?").bind(id).first<EntryRow>();
}

export async function queryEntries(
  db: D1Database, q: EntryQuery,
): Promise<{ rows: EntryRow[]; total: number }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.since !== undefined) { where.push("e.created_at > ?"); params.push(q.since); }
  if (q.feedId !== undefined) { where.push("e.feed_id = ?"); params.push(q.feedId); }
  if (q.ids !== undefined) {
    if (q.ids.length === 0) return { rows: [], total: 0 };
    where.push(`e.id IN (${q.ids.map(() => "?").join(",")})`);
    params.push(...q.ids);
  }
  if (q.onlyUnread) where.push("e.id IN (SELECT entry_id FROM unread_entries)");
  if (q.onlyStarred) where.push("e.id IN (SELECT entry_id FROM starred_entries)");
  const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const [count, page] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS n FROM entries e ${clause}`).bind(...params),
    db.prepare(
      `SELECT e.* FROM entries e ${clause} ORDER BY e.created_at DESC, e.id DESC LIMIT ? OFFSET ?`,
    ).bind(...params, q.perPage, (q.page - 1) * q.perPage),
  ]);
  const total = (count!.results[0] as { n: number }).n;
  return { rows: page!.results as EntryRow[], total };
}

export async function findEntryIdsByUrls(db: D1Database, urls: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const part of chunk(urls)) {
    const { results } = await db.prepare(
      `SELECT id, url FROM entries WHERE url IN (${part.map(() => "?").join(",")})`,
    ).bind(...part).all<{ id: number; url: string }>();
    for (const r of results) out.set(r.url, r.id);
  }
  return out;
}

export interface EntryIdQuery {
  limit: number; offset: number; createdSince?: string; feedId?: number;
  onlyUnread?: boolean; onlyStarred?: boolean;
}

export async function listEntryIds(
  db: D1Database, q: EntryIdQuery,
): Promise<{ ids: number[]; hasMore: boolean }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.createdSince !== undefined) { where.push("created_at >= ?"); params.push(q.createdSince); }
  if (q.feedId !== undefined) { where.push("feed_id = ?"); params.push(q.feedId); }
  if (q.onlyUnread) where.push("id IN (SELECT entry_id FROM unread_entries)");
  if (q.onlyStarred) where.push("id IN (SELECT entry_id FROM starred_entries)");
  const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const { results } = await db.prepare(
    `SELECT id FROM entries ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`,
  ).bind(...params, q.limit + 1, q.offset).all<{ id: number }>();
  const ids = results.map((r) => r.id);
  return { ids: ids.slice(0, q.limit), hasMore: ids.length > q.limit };
}

export interface EntryWithState extends EntryRow { feed_title: string; feed_site_url: string | null; is_unread: number; is_starred: number }

export async function getEntriesWithState(db: D1Database, ids: number[]): Promise<EntryWithState[]> {
  const byId = new Map<number, EntryWithState>();
  for (const part of chunk(ids)) {
    const { results } = await db.prepare(
      `SELECT e.*, f.title AS feed_title, f.site_url AS feed_site_url,
              EXISTS (SELECT 1 FROM unread_entries u WHERE u.entry_id = e.id) AS is_unread,
              EXISTS (SELECT 1 FROM starred_entries s WHERE s.entry_id = e.id) AS is_starred
       FROM entries e JOIN feeds f ON f.id = e.feed_id
       WHERE e.id IN (${part.map(() => "?").join(",")})`,
    ).bind(...part).all<EntryWithState>();
    for (const r of results) byId.set(r.id, r);
  }
  return ids.flatMap((id) => { const r = byId.get(id); return r ? [r] : []; });
}
