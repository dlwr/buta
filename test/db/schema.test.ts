import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";

describe("schema", () => {
  it("creates the five tables", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'd1_%' ORDER BY name",
    ).all<{ name: string }>();
    expect(results.map((r) => r.name)).toEqual(
      ["entries", "feeds", "starred_entries", "taggings", "unread_entries"],
    );
  });

  it("deleting a feed cascades to its entries", async () => {
    await env.DB.prepare("INSERT INTO feeds (id, feed_url, title, created_at) VALUES (1, 'https://a/feed', 'A', 't')").run();
    await env.DB.prepare("INSERT INTO entries (feed_id, dedup_key, published, created_at) VALUES (1, 'k', 't', 't')").run();
    await env.DB.prepare("DELETE FROM feeds WHERE id = 1").run();
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM entries").first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});
