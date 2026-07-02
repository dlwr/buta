import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import worker from "../src/index";
import { initSchema } from "../src/db/queries";

beforeEach(async () => {
  await initSchema(env.DB);
  await env.DB.exec("DELETE FROM entries");
  await env.DB.exec("DELETE FROM taggings");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO taggings (id, feed_id, name) VALUES (1, 1, 'Must Read')"),
    env.DB.prepare("INSERT INTO taggings (id, feed_id, name) VALUES (2, 2, 'Blog')"),
    env.DB.prepare("INSERT INTO entries (id, feed_id, title, url, created_at, is_unread, synced_at) VALUES (1, 1, 'core', null, '2026-07-01T09:00:00Z', 1, 't')"),
    env.DB.prepare("INSERT INTO entries (id, feed_id, title, url, created_at, is_unread, synced_at) VALUES (2, 2, 'tail', null, '2026-07-01T08:00:00Z', 1, 't')"),
  ]);
});

describe("GET /feed", () => {
  it("401 without a valid token", async () => {
    const res = await worker.fetch(
      new Request("https://buta.example/feed"),
      env as never, {} as never,
    );
    expect(res.status).toBe(401);
  });

  it("returns tier1 and tier2 from the D1 mirror when authorized", async () => {
    const res = await worker.fetch(
      new Request("https://buta.example/feed", {
        headers: { Authorization: "Bearer test-token" },
      }),
      env as never, {} as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { tier1: { id: number }[]; tier2: { id: number }[] };
    expect(body.tier1.map((x) => x.id)).toEqual([1]);
    expect(body.tier2.map((x) => x.id)).toEqual([2]);
  });
});
