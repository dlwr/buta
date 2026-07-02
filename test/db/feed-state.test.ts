import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { initSchema, getFeedLastSurfaced } from "../../src/db/queries";

beforeEach(async () => {
  await initSchema(env.DB);
  await env.DB.exec("DELETE FROM feed_state");
});

describe("getFeedLastSurfaced", () => {
  it("returns a map of feed_id -> last_surfaced, skipping nulls", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO feed_state (feed_id, last_surfaced) VALUES (1, '2026-07-01T00:00:00Z')"),
      env.DB.prepare("INSERT INTO feed_state (feed_id, last_surfaced) VALUES (2, NULL)"),
    ]);
    const m = await getFeedLastSurfaced(env.DB);
    expect(m.get(1)).toBe("2026-07-01T00:00:00Z");
    expect(m.has(2)).toBe(false);
    expect(m.size).toBe(1);
  });
});
