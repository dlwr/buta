import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import {
  initSchema, upsertEntries, markEntriesReadLocal, setEntriesStarredLocal,
  getFeedIdsForEntries, touchFeedLastSurfaced, getFeedLastSurfaced,
} from "../../src/db/queries";
import type { FeedbinEntry } from "../../src/feedbin/types";

function entry(id: number, feed: number): FeedbinEntry {
  return {
    id, feed_id: feed, title: `t${id}`, url: null, author: null,
    summary: null, content: null, published: null, created_at: "2026-07-01T00:00:00Z",
  };
}

beforeEach(async () => {
  await initSchema(env.DB);
  await env.DB.exec("DELETE FROM entries");
  await env.DB.exec("DELETE FROM feed_state");
});

describe("write-back helpers", () => {
  it("markEntriesReadLocal clears is_unread for listed ids only, even 200+ ids", async () => {
    const ids = Array.from({ length: 200 }, (_, i) => i + 1);
    await upsertEntries(env.DB, ids.map((i) => entry(i, 1)), "t");
    await env.DB.prepare("UPDATE entries SET is_unread = 1").run();
    await markEntriesReadLocal(env.DB, ids.slice(0, 150));
    const row = await env.DB.prepare(
      "SELECT sum(is_unread) unread FROM entries",
    ).first<{ unread: number }>();
    expect(row?.unread).toBe(50);
  });

  it("setEntriesStarredLocal sets and clears the flag", async () => {
    await upsertEntries(env.DB, [entry(1, 1)], "t");
    await setEntriesStarredLocal(env.DB, [1], true);
    let row = await env.DB.prepare("SELECT is_starred FROM entries WHERE id=1").first<{ is_starred: number }>();
    expect(row?.is_starred).toBe(1);
    await setEntriesStarredLocal(env.DB, [1], false);
    row = await env.DB.prepare("SELECT is_starred FROM entries WHERE id=1").first<{ is_starred: number }>();
    expect(row?.is_starred).toBe(0);
  });

  it("getFeedIdsForEntries returns the distinct feed set", async () => {
    await upsertEntries(env.DB, [entry(1, 10), entry(2, 10), entry(3, 20)], "t");
    const feeds = await getFeedIdsForEntries(env.DB, [1, 2, 3]);
    expect([...feeds].sort()).toEqual([10, 20]);
  });

  it("touchFeedLastSurfaced upserts and getFeedLastSurfaced reads it back", async () => {
    await touchFeedLastSurfaced(env.DB, [10], "2026-07-02T00:00:00Z");
    await touchFeedLastSurfaced(env.DB, [10, 20], "2026-07-02T01:00:00Z");
    const m = await getFeedLastSurfaced(env.DB);
    expect(m.get(10)).toBe("2026-07-02T01:00:00Z"); // updated, not duplicated
    expect(m.get(20)).toBe("2026-07-02T01:00:00Z");
  });
});
