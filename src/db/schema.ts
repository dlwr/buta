export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS taggings (
     id INTEGER PRIMARY KEY,
     feed_id INTEGER NOT NULL,
     name TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_taggings_feed ON taggings(feed_id)`,
  `CREATE TABLE IF NOT EXISTS entries (
     id INTEGER PRIMARY KEY,
     feed_id INTEGER NOT NULL,
     title TEXT,
     url TEXT,
     author TEXT,
     summary TEXT,
     content TEXT,
     published TEXT,
     created_at TEXT,
     is_unread INTEGER NOT NULL DEFAULT 1,
     is_starred INTEGER NOT NULL DEFAULT 0,
     synced_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_entries_feed ON entries(feed_id)`,
  `CREATE INDEX IF NOT EXISTS idx_entries_unread ON entries(is_unread)`,
];
