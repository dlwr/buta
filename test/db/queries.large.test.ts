import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { initSchema, upsertEntries, setUnreadFlags, setStarredFlags } from "../../src/db/queries";
import type { FeedbinEntry } from "../../src/feedbin/types";

function entry(id: number): FeedbinEntry {
  return {
    id, feed_id: 1, title: `t${id}`, url: null, author: null,
    summary: null, content: null, published: null, created_at: "2026-07-01T00:00:00Z",
  };
}

beforeEach(async () => {
  await initSchema(env.DB);
  await env.DB.exec("DELETE FROM entries");
});

describe("flag updates with large id lists", () => {
  it("setUnreadFlags marks all ids even when there are thousands", async () => {
    const ids = Array.from({ length: 1500 }, (_, i) => i + 1);
    await upsertEntries(env.DB, ids.map(entry), "2026-07-01T00:00:00Z");

    await setUnreadFlags(env.DB, ids);

    const row = await env.DB.prepare(
      "SELECT count(*) c FROM entries WHERE is_unread = 1",
    ).first<{ c: number }>();
    expect(row?.c).toBe(1500);
  });

  it("setStarredFlags marks all ids even when there are thousands", async () => {
    const ids = Array.from({ length: 1500 }, (_, i) => i + 1);
    await upsertEntries(env.DB, ids.map(entry), "2026-07-01T00:00:00Z");

    await setStarredFlags(env.DB, ids);

    const row = await env.DB.prepare(
      "SELECT count(*) c FROM entries WHERE is_starred = 1",
    ).first<{ c: number }>();
    expect(row?.c).toBe(1500);
  });
});
