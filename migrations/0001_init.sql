CREATE TABLE feeds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_url TEXT NOT NULL UNIQUE,
  site_url TEXT,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  etag TEXT,
  last_modified TEXT,
  last_fetched_at TEXT,
  error_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE TABLE entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_id INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  dedup_key TEXT NOT NULL,
  title TEXT,
  url TEXT,
  author TEXT,
  summary TEXT,
  content TEXT,
  published TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (feed_id, dedup_key)
);
CREATE INDEX idx_entries_created ON entries(created_at, id);
CREATE INDEX idx_entries_url ON entries(url);

CREATE TABLE unread_entries (
  entry_id INTEGER PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE
);

CREATE TABLE starred_entries (
  entry_id INTEGER PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE
);

CREATE TABLE taggings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_id INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  UNIQUE (feed_id, name)
);
