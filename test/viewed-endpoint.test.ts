import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { env } from "cloudflare:test";
import worker from "../src/index";
import { initSchema, getFeedLastSurfaced } from "../src/db/queries";

const AUTH = { Authorization: "Bearer test-token", "Content-Type": "application/json" };

beforeEach(async () => {
  await initSchema(env.DB);
  await env.DB.exec("DELETE FROM entries");
  await env.DB.exec("DELETE FROM feed_state");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO entries (id, feed_id, title, url, created_at, is_unread, synced_at) VALUES (1, 10, 'a', null, 't', 1, 't')"),
    env.DB.prepare("INSERT INTO entries (id, feed_id, title, url, created_at, is_unread, synced_at) VALUES (2, 20, 'b', null, 't', 1, 't')"),
  ]);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFeedbin(status = 200) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url: String(url), method: init?.method ?? "GET", body });
    const ids = body ? (Object.values(body)[0] as number[]) : [];
    return new Response(status === 200 ? JSON.stringify(ids) : null, { status });
  });
  return calls;
}

function post(body: unknown) {
  return worker.fetch(
    new Request("https://buta.example/viewed", {
      method: "POST", headers: AUTH, body: JSON.stringify(body),
    }),
    env as never, {} as never,
  );
}

describe("POST /viewed", () => {
  it("401 without token", async () => {
    const res = await worker.fetch(
      new Request("https://buta.example/viewed", { method: "POST", body: "{}" }),
      env as never, {} as never,
    );
    expect(res.status).toBe(401);
  });

  it("marks read in Feedbin then locally, and touches last_surfaced", async () => {
    const calls = stubFeedbin();
    const res = await post({ entryIds: [1, 2] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ read: 2, feedsTouched: 2 });

    // Feedbin call happened
    expect(calls[0]!.url).toContain("/unread_entries.json");
    expect(calls[0]!.method).toBe("DELETE");

    // local mirror updated
    const row = await env.DB.prepare("SELECT sum(is_unread) u FROM entries").first<{ u: number }>();
    expect(row?.u).toBe(0);

    // last_surfaced advanced for both feeds
    const m = await getFeedLastSurfaced(env.DB);
    expect(m.has(10)).toBe(true);
    expect(m.has(20)).toBe(true);
  });

  it("returns 502 and leaves local state untouched when Feedbin fails", async () => {
    stubFeedbin(500);
    const res = await post({ entryIds: [1] });
    expect(res.status).toBe(502);
    const row = await env.DB.prepare("SELECT is_unread FROM entries WHERE id=1").first<{ is_unread: number }>();
    expect(row?.is_unread).toBe(1);
    expect((await getFeedLastSurfaced(env.DB)).size).toBe(0);
  });

  it("400 on malformed body", async () => {
    const res = await post({ entryIds: "nope" });
    expect(res.status).toBe(400);
  });
});
