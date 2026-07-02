import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { syncAll } from "../../src/sync/sync";
import { initSchema } from "../../src/db/queries";
import type { FeedbinEntry, FeedbinTagging } from "../../src/feedbin/types";

function bigClient(n: number) {
  const unread = Array.from({ length: n }, (_, i) => i + 1);
  const taggings: FeedbinTagging[] = Array.from({ length: 500 }, (_, i) => ({
    id: i + 1, feed_id: (i % 50) + 1, name: i % 5 === 0 ? "Must Read" : "Blog",
  }));
  return {
    async getTaggings() { return taggings; },
    async getUnreadEntryIds() { return unread; },
    async getStarredEntryIds() { return unread.slice(0, 200); },
    async getEntriesByIds(ids: number[]): Promise<FeedbinEntry[]> {
      return ids.map((id) => ({
        id, feed_id: (id % 50) + 1, title: `t${id}`, url: `http://x/${id}`,
        author: null, summary: "s", content: "c", published: null,
        created_at: "2026-07-01T00:00:00Z",
      }));
    },
  };
}

beforeEach(async () => {
  await initSchema(env.DB);
  await env.DB.exec("DELETE FROM entries");
  await env.DB.exec("DELETE FROM taggings");
});

describe("syncAll at realistic scale", () => {
  it("syncs 2500 unread end-to-end without hitting SQL-variable limits", async () => {
    const result = await syncAll({
      db: env.DB, kv: env.SYNC_KV, client: bigClient(2500),
      now: () => "2026-07-01T12:00:00Z",
    });

    expect(result.hydrated).toBe(2500);
    const row = await env.DB.prepare(
      "SELECT count(*) n, sum(is_unread) unread, sum(is_starred) starred FROM entries",
    ).first<{ n: number; unread: number; starred: number }>();
    expect(row).toEqual({ n: 2500, unread: 2500, starred: 200 });
    expect(await env.SYNC_KV.get("last_sync")).toBe("2026-07-01T12:00:00Z");
  });
});
