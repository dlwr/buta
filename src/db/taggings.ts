export interface TaggingRow { id: number; feed_id: number; name: string }

export async function listTaggings(db: D1Database): Promise<TaggingRow[]> {
  const { results } = await db.prepare("SELECT * FROM taggings ORDER BY id").all<TaggingRow>();
  return results;
}

export async function findTagging(db: D1Database, feedId: number, name: string): Promise<TaggingRow | null> {
  return db.prepare("SELECT * FROM taggings WHERE feed_id = ? AND name = ?").bind(feedId, name).first<TaggingRow>();
}

export async function insertTagging(db: D1Database, feedId: number, name: string): Promise<TaggingRow> {
  const row = await db.prepare(
    "INSERT INTO taggings (feed_id, name) VALUES (?, ?) RETURNING *",
  ).bind(feedId, name).first<TaggingRow>();
  if (!row) throw new Error("insertTagging returned no row");
  return row;
}

export async function deleteTagging(db: D1Database, id: number): Promise<boolean> {
  const r = await db.prepare("DELETE FROM taggings WHERE id = ?").bind(id).run();
  return r.meta.changes > 0;
}

export async function renameTag(db: D1Database, oldName: string, newName: string): Promise<void> {
  await db.prepare("UPDATE taggings SET name = ? WHERE name = ?").bind(newName, oldName).run();
}

export async function deleteTag(db: D1Database, name: string): Promise<void> {
  await db.prepare("DELETE FROM taggings WHERE name = ?").bind(name).run();
}
