import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import {
  initSchema, upsertEntries, upsertTaggings,
  setUnreadFlags, setStarredFlags, getTrackedEntryIds,
} from "../../src/db/queries";
import type { FeedbinEntry } from "../../src/feedbin/types";

function entry(id: number, over: Partial<FeedbinEntry> = {}): FeedbinEntry {
  return {
    id, feed_id: 1, title: `t${id}`, url: `http://x/${id}`, author: null,
    summary: "s", content: "c", published: null, created_at: "2026-07-01T00:00:00Z",
    ...over,
  };
}

beforeEach(async () => {
  await initSchema(env.DB);
  await env.DB.exec("DELETE FROM entries");
  await env.DB.exec("DELETE FROM taggings");
});

describe("queries", () => {
  it("upsertTaggings replaces existing rows", async () => {
    await upsertTaggings(env.DB, [{ id: 4, feed_id: 1, name: "Core" }]);
    await upsertTaggings(env.DB, [{ id: 5, feed_id: 2, name: "News" }]);
    const { results } = await env.DB.prepare("SELECT id, name FROM taggings ORDER BY id").all();
    expect(results).toEqual([{ id: 5, name: "News" }]);
  });

  it("upsertEntries inserts and getTrackedEntryIds returns them", async () => {
    await upsertEntries(env.DB, [entry(1), entry(2)], "2026-07-01T00:00:00Z");
    const ids = await getTrackedEntryIds(env.DB);
    expect([...ids].sort()).toEqual([1, 2]);
  });

  it("upsertEntries preserves is_unread/is_starred on re-sync", async () => {
    await upsertEntries(env.DB, [entry(1)], "2026-07-01T00:00:00Z");
    await setUnreadFlags(env.DB, []);          // mark id 1 as read
    await setStarredFlags(env.DB, [1]);        // star id 1
    await upsertEntries(env.DB, [entry(1, { title: "updated" })], "2026-07-02T00:00:00Z");
    const row = await env.DB.prepare(
      "SELECT title, is_unread, is_starred FROM entries WHERE id = 1",
    ).first<{ title: string; is_unread: number; is_starred: number }>();
    expect(row).toEqual({ title: "updated", is_unread: 0, is_starred: 1 });
  });

  it("setUnreadFlags marks only listed ids unread", async () => {
    await upsertEntries(env.DB, [entry(1), entry(2), entry(3)], "2026-07-01T00:00:00Z");
    await setUnreadFlags(env.DB, [2]);
    const rows = await env.DB.prepare(
      "SELECT id, is_unread FROM entries ORDER BY id",
    ).all();
    expect(rows.results).toEqual([
      { id: 1, is_unread: 0 }, { id: 2, is_unread: 1 }, { id: 3, is_unread: 0 },
    ]);
  });
});
