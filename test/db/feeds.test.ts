import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { insertFeed, listFeeds, getFeed, findFeedByUrl, renameFeed, deleteFeed, recordFetchSuccess, recordFetchFailure } from "../../src/db/feeds";

beforeEach(async () => { await env.DB.prepare("DELETE FROM feeds WHERE id > 0").run(); });

const input = { feedUrl: "https://a/feed", siteUrl: "https://a/", title: "A", createdAt: "2026-09-10T00:00:00.000Z" };

describe("feeds", () => {
  it("insertFeed returns the row with an id", async () => {
    const row = await insertFeed(env.DB, input);
    expect(row).toMatchObject({ feed_url: "https://a/feed", title: "A", error_count: 0 });
    expect(row.id).toBeGreaterThan(0);
  });

  it("listFeeds orders by id", async () => {
    const a = await insertFeed(env.DB, { ...input, feedUrl: "https://a/1" });
    const b = await insertFeed(env.DB, { ...input, feedUrl: "https://a/2" });
    const c = await insertFeed(env.DB, { ...input, feedUrl: "https://a/3" });
    expect((await listFeeds(env.DB)).map((f) => f.id)).toEqual([a.id, b.id, c.id]);
  });

  it("findFeedByUrl finds by exact url", async () => {
    const row = await insertFeed(env.DB, input);
    expect((await findFeedByUrl(env.DB, "https://a/feed"))?.id).toBe(row.id);
  });

  it("getFeed returns null for unknown id", async () => {
    expect(await getFeed(env.DB, 9999)).toBeNull();
  });

  it("renameFeed updates title", async () => {
    const row = await insertFeed(env.DB, input);
    expect(await renameFeed(env.DB, row.id, "B")).toBe(true);
    expect((await getFeed(env.DB, row.id))?.title).toBe("B");
  });

  it("deleteFeed returns false for unknown id", async () => {
    expect(await deleteFeed(env.DB, 9999)).toBe(false);
  });

  it("recordFetchSuccess stores validators and clears errors", async () => {
    const row = await insertFeed(env.DB, input);
    await recordFetchFailure(env.DB, row.id, { message: "x", fetchedAt: "t1" });
    await recordFetchSuccess(env.DB, row.id, { etag: '"e"', lastModified: "lm", fetchedAt: "t2" });
    expect(await getFeed(env.DB, row.id)).toMatchObject({ etag: '"e"', last_modified: "lm", last_fetched_at: "t2", error_count: 0, last_error: null });
  });

  it("recordFetchFailure increments error_count", async () => {
    const row = await insertFeed(env.DB, input);
    await recordFetchFailure(env.DB, row.id, { message: "x", fetchedAt: "t1" });
    await recordFetchFailure(env.DB, row.id, { message: "y", fetchedAt: "t2" });
    expect(await getFeed(env.DB, row.id)).toMatchObject({ error_count: 2, last_error: "y", last_fetched_at: "t2" });
  });
});
