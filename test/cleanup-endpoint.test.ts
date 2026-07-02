import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { env } from "cloudflare:test";
import worker from "../src/index";
import { initSchema, getFeedLastSurfaced } from "../src/db/queries";

const AUTH = { Authorization: "Bearer test-token", "Content-Type": "application/json" };
const OLD = "2026-06-01T00:00:00Z";
const FRESH = "2026-07-02T00:00:00Z";

beforeEach(async () => {
  await initSchema(env.DB);
  await env.DB.exec("DELETE FROM entries");
  await env.DB.exec("DELETE FROM taggings");
  await env.DB.exec("DELETE FROM feed_state");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO taggings (id, feed_id, name) VALUES (1, 1, 'Must Read')"),
    env.DB.prepare("INSERT INTO taggings (id, feed_id, name) VALUES (2, 2, 'Blog')"),
    // core feed, old -> must NOT be cleaned
    env.DB.prepare(`INSERT INTO entries (id, feed_id, title, url, created_at, is_unread, synced_at) VALUES (1, 1, 'core-old', null, '${OLD}', 1, 't')`),
    // tail feed, old -> cleaned
    env.DB.prepare(`INSERT INTO entries (id, feed_id, title, url, created_at, is_unread, synced_at) VALUES (2, 2, 'tail-old', null, '${OLD}', 1, 't')`),
    // tail feed, fresh -> kept
    env.DB.prepare(`INSERT INTO entries (id, feed_id, title, url, created_at, is_unread, synced_at) VALUES (3, 2, 'tail-fresh', null, '${FRESH}', 1, 't')`),
  ]);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFeedbin() {
  const bodies: unknown[] = [];
  vi.stubGlobal("fetch", async (_url: string | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    bodies.push(body);
    return new Response(JSON.stringify(Object.values(body)[0] ?? []), { status: 200 });
  });
  return bodies;
}

function post(body: unknown) {
  return worker.fetch(
    new Request("https://buta.example/cleanup", {
      method: "POST", headers: AUTH, body: JSON.stringify(body),
    }),
    env as never, {} as never,
  );
}

describe("POST /cleanup", () => {
  it("marks only old tail entries read, never core, never fresh", async () => {
    const bodies = stubFeedbin();
    const res = await post({ olderThanDays: 7 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ read: 1 });
    expect(bodies[0]).toEqual({ unread_entries: [2] });

    const rows = await env.DB.prepare(
      "SELECT id, is_unread FROM entries ORDER BY id",
    ).all();
    expect(rows.results).toEqual([
      { id: 1, is_unread: 1 },  // core untouched
      { id: 2, is_unread: 0 },  // old tail cleaned
      { id: 3, is_unread: 1 },  // fresh tail kept
    ]);
    // cleanup is not a "view": last_surfaced untouched
    expect((await getFeedLastSurfaced(env.DB)).size).toBe(0);
  });

  it("400 on missing/invalid olderThanDays", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ olderThanDays: -1 })).status).toBe(400);
  });
});
