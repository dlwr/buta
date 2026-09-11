import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { insertFeed } from "../../src/db/feeds";
import { insertNewEntries, listEntryIds, getEntriesWithState } from "../../src/db/entries";
import { addMarks } from "../../src/db/marks";

let f1: number; let f2: number; let ids: number[];
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM feeds WHERE id > 0").run();
  f1 = (await insertFeed(env.DB, { feedUrl: "https://a/1", siteUrl: null, title: "One", createdAt: "t" })).id;
  f2 = (await insertFeed(env.DB, { feedUrl: "https://a/2", siteUrl: null, title: "Two", createdAt: "t" })).id;
  ids = await insertNewEntries(env.DB, [
    { feedId: f1, dedupKey: "a", title: "a", url: "https://a/a", author: null, summary: null, content: "<p>a</p>", published: "2026-09-01T00:00:00.000Z", createdAt: "2026-09-01T00:00:00.000Z" },
    { feedId: f1, dedupKey: "b", title: "b", url: null, author: "au", summary: "s", content: null, published: "2026-09-02T00:00:00.000Z", createdAt: "2026-09-02T00:00:00.000Z" },
    { feedId: f2, dedupKey: "c", title: "c", url: null, author: null, summary: null, content: null, published: "2026-09-03T00:00:00.000Z", createdAt: "2026-09-03T00:00:00.000Z" },
  ]);
});

describe("listEntryIds", () => {
  it("returns ids newest first with limit+1 detection of more", async () => {
    const r = await listEntryIds(env.DB, { limit: 2, offset: 0 });
    expect(r.ids).toEqual([ids[2], ids[1]]);
    expect(r.hasMore).toBe(true);
  });
  it("reports no more on the last page", async () => {
    const r = await listEntryIds(env.DB, { limit: 2, offset: 2 });
    expect(r.ids).toEqual([ids[0]]);
    expect(r.hasMore).toBe(false);
  });
  it("filters by createdSince inclusive", async () => {
    const r = await listEntryIds(env.DB, { limit: 10, offset: 0, createdSince: "2026-09-02T00:00:00.000Z" });
    expect(r.ids).toEqual([ids[2], ids[1]]);
  });
  it("filters by feedId", async () => {
    const r = await listEntryIds(env.DB, { limit: 10, offset: 0, feedId: f2 });
    expect(r.ids).toEqual([ids[2]]);
  });
  it("filters to unread", async () => {
    await addMarks(env.DB, "unread_entries", [ids[0]!]);
    const r = await listEntryIds(env.DB, { limit: 10, offset: 0, onlyUnread: true });
    expect(r.ids).toEqual([ids[0]]);
  });
  it("filters to starred", async () => {
    await addMarks(env.DB, "starred_entries", [ids[1]!]);
    const r = await listEntryIds(env.DB, { limit: 10, offset: 0, onlyStarred: true });
    expect(r.ids).toEqual([ids[1]]);
  });
});

describe("getEntriesWithState", () => {
  it("returns rows with feed title and unread/starred flags in requested order", async () => {
    await addMarks(env.DB, "unread_entries", [ids[1]!]);
    await addMarks(env.DB, "starred_entries", [ids[0]!]);
    const rows = await getEntriesWithState(env.DB, [ids[1]!, ids[0]!]);
    expect(rows.map((r) => [r.id, r.feed_title, r.is_unread, r.is_starred])).toEqual([
      [ids[1], "One", 1, 0],
      [ids[0], "One", 0, 1],
    ]);
  });
  it("skips unknown ids", async () => {
    expect(await getEntriesWithState(env.DB, [999_999])).toEqual([]);
  });
  it("returns empty for empty input", async () => {
    expect(await getEntriesWithState(env.DB, [])).toEqual([]);
  });
});
