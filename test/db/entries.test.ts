import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { insertFeed } from "../../src/db/feeds";
import { insertNewEntries, queryEntries, getEntry, findEntryIdsByUrls, type NewEntry } from "../../src/db/entries";
import { addMarks } from "../../src/db/marks";

let feedId: number;
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM feeds WHERE id > 0").run();
  feedId = (await insertFeed(env.DB, { feedUrl: "https://a/feed", siteUrl: null, title: "A", createdAt: "t" })).id;
});

function entry(key: string, createdAt: string, extra: Partial<NewEntry> = {}): NewEntry {
  return { feedId, dedupKey: key, title: key, url: `https://a/${key}`, author: null, summary: null, content: null,
    published: createdAt, createdAt, ...extra };
}

describe("insertNewEntries", () => {
  it("returns ids of inserted rows", async () => {
    const ids = await insertNewEntries(env.DB, [entry("a", "t1"), entry("b", "t2")]);
    expect(ids).toHaveLength(2);
  });

  it("ignores duplicates by (feed_id, dedup_key) and returns only new ids", async () => {
    await insertNewEntries(env.DB, [entry("a", "t1")]);
    const ids = await insertNewEntries(env.DB, [entry("a", "t1"), entry("b", "t2")]);
    expect(ids).toHaveLength(1);
    expect((await getEntry(env.DB, ids[0]!))?.title).toBe("b");
  });

  it("returns empty for empty input", async () => {
    expect(await insertNewEntries(env.DB, [])).toEqual([]);
  });
});

describe("queryEntries", () => {
  beforeEach(async () => {
    await insertNewEntries(env.DB, [entry("a", "2026-09-01T00:00:00.000Z"), entry("b", "2026-09-02T00:00:00.000Z"), entry("c", "2026-09-03T00:00:00.000Z")]);
  });

  it("orders newest created_at first", async () => {
    const { rows } = await queryEntries(env.DB, { page: 1, perPage: 100 });
    expect(rows.map((r) => r.title)).toEqual(["c", "b", "a"]);
  });

  it("paginates with perPage and page", async () => {
    const { rows, total } = await queryEntries(env.DB, { page: 2, perPage: 2 });
    expect(rows.map((r) => r.title)).toEqual(["a"]);
    expect(total).toBe(3);
  });

  it("filters by since (strictly after)", async () => {
    const { rows } = await queryEntries(env.DB, { page: 1, perPage: 100, since: "2026-09-02T00:00:00.000Z" });
    expect(rows.map((r) => r.title)).toEqual(["c"]);
  });

  it("filters by ids", async () => {
    const all = (await queryEntries(env.DB, { page: 1, perPage: 100 })).rows;
    const { rows } = await queryEntries(env.DB, { page: 1, perPage: 100, ids: [all[0]!.id, all[2]!.id] });
    expect(rows.map((r) => r.title)).toEqual(["c", "a"]);
  });

  it("returns nothing for an empty ids list", async () => {
    const { rows, total } = await queryEntries(env.DB, { page: 1, perPage: 100, ids: [] });
    expect(rows).toEqual([]);
    expect(total).toBe(0);
  });

  it("filters by feedId", async () => {
    const other = await insertFeed(env.DB, { feedUrl: "https://b/feed", siteUrl: null, title: "B", createdAt: "t" });
    await insertNewEntries(env.DB, [entry("z", "2026-09-09T00:00:00.000Z", { feedId: other.id })]);
    const { rows } = await queryEntries(env.DB, { page: 1, perPage: 100, feedId: other.id });
    expect(rows.map((r) => r.title)).toEqual(["z"]);
  });

  it("filters to unread only", async () => {
    const all = (await queryEntries(env.DB, { page: 1, perPage: 100 })).rows;
    await addMarks(env.DB, "unread_entries", [all[1]!.id]);
    const { rows } = await queryEntries(env.DB, { page: 1, perPage: 100, onlyUnread: true });
    expect(rows.map((r) => r.title)).toEqual(["b"]);
  });

  it("filters to starred only", async () => {
    const all = (await queryEntries(env.DB, { page: 1, perPage: 100 })).rows;
    await addMarks(env.DB, "starred_entries", [all[2]!.id]);
    const { rows } = await queryEntries(env.DB, { page: 1, perPage: 100, onlyStarred: true });
    expect(rows.map((r) => r.title)).toEqual(["a"]);
  });
});

describe("findEntryIdsByUrls", () => {
  it("maps url to id for matches only", async () => {
    const [id] = await insertNewEntries(env.DB, [entry("a", "t1")]);
    const map = await findEntryIdsByUrls(env.DB, ["https://a/a", "https://a/nope"]);
    expect([...map.entries()]).toEqual([["https://a/a", id]]);
  });

  it("returns an empty map for no urls", async () => {
    expect((await findEntryIdsByUrls(env.DB, [])).size).toBe(0);
  });
});
