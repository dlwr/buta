import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import worker from "../../src/index";
import { insertFeed } from "../../src/db/feeds";
import { insertNewEntries } from "../../src/db/entries";
import { addMarks, listMarked } from "../../src/db/marks";
import { migrateLegacyState } from "../../src/admin/migrate-legacy";

let ids: number[];
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM feeds WHERE id > 0").run();
  await env.DB.exec("DROP TABLE IF EXISTS legacy_entries");
  await env.DB.exec("CREATE TABLE legacy_entries (id INTEGER PRIMARY KEY, url TEXT, is_unread INTEGER NOT NULL DEFAULT 1, is_starred INTEGER NOT NULL DEFAULT 0)");
  const feedId = (await insertFeed(env.DB, { feedUrl: "https://a/feed", siteUrl: null, title: "A", createdAt: "t" })).id;
  ids = await insertNewEntries(env.DB, ["a", "b", "c"].map((k) => ({
    feedId, dedupKey: k, title: k, url: `https://a/${k}`, author: null, summary: null, content: null, published: "t", createdAt: "t",
  })));
  await addMarks(env.DB, "unread_entries", ids);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO legacy_entries (id, url, is_unread, is_starred) VALUES (1, 'https://a/a', 0, 0)"),
    env.DB.prepare("INSERT INTO legacy_entries (id, url, is_unread, is_starred) VALUES (2, 'https://a/b', 1, 1)"),
    env.DB.prepare("INSERT INTO legacy_entries (id, url, is_unread, is_starred) VALUES (3, 'https://a/zzz', 0, 1)"),
  ]);
});

describe("migrateLegacyState", () => {
  it("marks entries read that were read in the legacy table", async () => {
    await migrateLegacyState(env.DB);
    expect(await listMarked(env.DB, "unread_entries")).toEqual([ids[1], ids[2]]);
  });
  it("stars entries that were starred in the legacy table", async () => {
    await migrateLegacyState(env.DB);
    expect(await listMarked(env.DB, "starred_entries")).toEqual([ids[1]]);
  });
  it("reports counts", async () => {
    expect(await migrateLegacyState(env.DB)).toEqual({ matched: 2, markedRead: 1, starred: 1 });
  });
  it("is idempotent", async () => {
    await migrateLegacyState(env.DB);
    expect(await migrateLegacyState(env.DB)).toEqual({ matched: 2, markedRead: 1, starred: 1 });
  });
});

describe("POST /admin/migrate-legacy", () => {
  it("runs the migration with the admin token", async () => {
    const res = await worker.fetch(new Request("https://buta.test/admin/migrate-legacy", {
      method: "POST", headers: { Authorization: "Bearer test-token" },
    }), env);
    expect(await res.json()).toEqual({ matched: 2, markedRead: 1, starred: 1 });
  });
});
