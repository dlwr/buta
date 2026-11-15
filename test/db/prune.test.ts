import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { insertFeed } from "../../src/db/feeds";
import { insertNewEntries, findPruneBoundaryId, pruneFeedEntries } from "../../src/db/entries";
import { addMarks } from "../../src/db/marks";

let f1: number; let f2: number; let ids: number[]; let other: number;

async function remaining(): Promise<number[]> {
  const { results } = await env.DB.prepare("SELECT id FROM entries ORDER BY id").all<{ id: number }>();
  return results.map((r) => r.id);
}

function entry(feedId: number, key: string, createdAt: string) {
  return { feedId, dedupKey: key, title: key, url: null, author: null, summary: null, content: "<p>x</p>", published: createdAt, createdAt };
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM feeds WHERE id > 0").run();
  f1 = (await insertFeed(env.DB, { feedUrl: "https://a/1", siteUrl: null, title: "One", createdAt: "t" })).id;
  f2 = (await insertFeed(env.DB, { feedUrl: "https://a/2", siteUrl: null, title: "Two", createdAt: "t" })).id;
  ids = await insertNewEntries(env.DB, [
    entry(f1, "a", "2026-06-01T00:00:00.000Z"),
    entry(f1, "b", "2026-06-02T00:00:00.000Z"),
    entry(f1, "c", "2026-06-03T00:00:00.000Z"),
    entry(f1, "d", "2026-09-01T00:00:00.000Z"),
  ]);
  [other] = await insertNewEntries(env.DB, [entry(f2, "a", "2026-06-01T00:00:00.000Z")]) as [number];
});

describe("findPruneBoundaryId", () => {
  it("returns the newest entry created before the cutoff", async () => {
    expect(await findPruneBoundaryId(env.DB, "2026-06-03T00:00:00.000Z")).toBe(ids[1]);
  });
  it("returns null when nothing is that old", async () => {
    expect(await findPruneBoundaryId(env.DB, "2026-01-01T00:00:00.000Z")).toBeNull();
  });
});

describe("pruneFeedEntries", () => {
  it("deletes read entries up to the boundary that the feed no longer lists", async () => {
    await pruneFeedEntries(env.DB, f1, ids[2]!, ["d"], 10);
    expect(await remaining()).toEqual([ids[3], other]);
  });
  it("reports how many it deleted", async () => {
    expect(await pruneFeedEntries(env.DB, f1, ids[2]!, ["d"], 10)).toBe(3);
  });
  it("keeps entries the feed still lists", async () => {
    await pruneFeedEntries(env.DB, f1, ids[2]!, ["b", "d"], 10);
    expect(await remaining()).toEqual([ids[1], ids[3], other]);
  });
  it("keeps unread entries", async () => {
    await addMarks(env.DB, "unread_entries", [ids[0]!]);
    await pruneFeedEntries(env.DB, f1, ids[2]!, ["d"], 10);
    expect(await remaining()).toEqual([ids[0], ids[3], other]);
  });
  it("keeps starred entries", async () => {
    await addMarks(env.DB, "starred_entries", [ids[2]!]);
    await pruneFeedEntries(env.DB, f1, ids[2]!, ["d"], 10);
    expect(await remaining()).toEqual([ids[2], ids[3], other]);
  });
  it("keeps entries newer than the boundary", async () => {
    await pruneFeedEntries(env.DB, f1, ids[1]!, [], 10);
    expect(await remaining()).toEqual([ids[2], ids[3], other]);
  });
  it("deletes no more than the limit", async () => {
    expect(await pruneFeedEntries(env.DB, f1, ids[2]!, ["d"], 2)).toBe(2);
  });
  it("finds candidates through the feed index, not a table scan", async () => {
    const seen: { sql: string; args: unknown[] }[] = [];
    const spy = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => { seen.push({ sql, args }); return env.DB.prepare(sql).bind(...args); },
      }),
    } as unknown as D1Database;
    await pruneFeedEntries(spy, f1, ids[2]!, ["d"], 10);
    const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${seen[0]!.sql}`).bind(...seen[0]!.args).all<{ detail: string }>();
    expect(results.map((r) => r.detail).join("\n")).toContain("SEARCH entries USING COVERING INDEX sqlite_autoindex_entries_1 (feed_id=?");
  });
});
