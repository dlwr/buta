import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { syncAll } from "../../src/sync/sync";
import { initSchema, upsertEntries, getTrackedEntryIds } from "../../src/db/queries";
import type { FeedbinEntry, FeedbinTagging } from "../../src/feedbin/types";

function entry(id: number): FeedbinEntry {
  return {
    id, feed_id: 1, title: `t${id}`, url: `http://x/${id}`, author: null,
    summary: "s", content: "c", published: null, created_at: "2026-07-01T00:00:00Z",
  };
}

function fakeClient(over: {
  taggings?: FeedbinTagging[]; unread?: number[]; starred?: number[];
} = {}) {
  const hydrated: number[][] = [];
  return {
    hydrated,
    async getTaggings() { return over.taggings ?? []; },
    async getUnreadEntryIds() { return over.unread ?? []; },
    async getStarredEntryIds() { return over.starred ?? []; },
    async getEntriesByIds(ids: number[]) { hydrated.push(ids); return ids.map(entry); },
  };
}

beforeEach(async () => {
  await initSchema(env.DB);
  await env.DB.exec("DELETE FROM entries");
  await env.DB.exec("DELETE FROM taggings");
});

describe("syncAll", () => {
  it("hydrates only untracked ids and records flags", async () => {
    await upsertEntries(env.DB, [entry(1)], "2026-06-30T00:00:00Z"); // already tracked
    const client = fakeClient({
      taggings: [{ id: 4, feed_id: 1, name: "Core" }],
      unread: [1, 2, 3],
      starred: [2],
    });

    const result = await syncAll({
      db: env.DB, kv: env.SYNC_KV, client, now: () => "2026-07-01T12:00:00Z",
    });

    // id 1 は既存なので、ハイドレートは 2,3 のみ
    expect(client.hydrated).toEqual([[2, 3]]);
    expect(result).toEqual({ hydrated: 2, unread: 3, starred: 1 });

    const tracked = await getTrackedEntryIds(env.DB);
    expect([...tracked].sort()).toEqual([1, 2, 3]);

    const flags = await env.DB.prepare(
      "SELECT id, is_unread, is_starred FROM entries ORDER BY id",
    ).all();
    expect(flags.results).toEqual([
      { id: 1, is_unread: 1, is_starred: 0 },
      { id: 2, is_unread: 1, is_starred: 1 },
      { id: 3, is_unread: 1, is_starred: 0 },
    ]);

    expect(await env.SYNC_KV.get("last_sync")).toBe("2026-07-01T12:00:00Z");
  });

  it("hydrates nothing when all ids already tracked", async () => {
    await upsertEntries(env.DB, [entry(1), entry(2)], "2026-06-30T00:00:00Z");
    const client = fakeClient({ unread: [1, 2], starred: [] });
    const result = await syncAll({
      db: env.DB, kv: env.SYNC_KV, client, now: () => "2026-07-01T12:00:00Z",
    });
    expect(client.hydrated).toEqual([]);
    expect(result.hydrated).toBe(0);
  });
});
