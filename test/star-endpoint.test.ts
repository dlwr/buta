import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { env } from "cloudflare:test";
import worker from "../src/index";
import { initSchema } from "../src/db/queries";

const AUTH = { Authorization: "Bearer test-token", "Content-Type": "application/json" };

beforeEach(async () => {
  await initSchema(env.DB);
  await env.DB.exec("DELETE FROM entries");
  await env.DB.prepare(
    "INSERT INTO entries (id, feed_id, title, url, created_at, is_unread, synced_at) VALUES (1, 10, 'a', null, 't', 1, 't')",
  ).run();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFeedbin() {
  const calls: { url: string; method: string }[] = [];
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET" });
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    return new Response(JSON.stringify(Object.values(body)[0] ?? []), { status: 200 });
  });
  return calls;
}

function post(body: unknown) {
  return worker.fetch(
    new Request("https://buta.example/star", {
      method: "POST", headers: AUTH, body: JSON.stringify(body),
    }),
    env as never, {} as never,
  );
}

describe("POST /star", () => {
  it("stars via Feedbin POST and updates the mirror", async () => {
    const calls = stubFeedbin();
    const res = await post({ entryIds: [1], starred: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 1 });
    expect(calls[0]!.url).toContain("/starred_entries.json");
    expect(calls[0]!.method).toBe("POST");
    const row = await env.DB.prepare("SELECT is_starred FROM entries WHERE id=1").first<{ is_starred: number }>();
    expect(row?.is_starred).toBe(1);
  });

  it("unstars via Feedbin DELETE", async () => {
    const calls = stubFeedbin();
    await env.DB.prepare("UPDATE entries SET is_starred = 1 WHERE id = 1").run();
    const res = await post({ entryIds: [1], starred: false });
    expect(res.status).toBe(200);
    expect(calls[0]!.method).toBe("DELETE");
    const row = await env.DB.prepare("SELECT is_starred FROM entries WHERE id=1").first<{ is_starred: number }>();
    expect(row?.is_starred).toBe(0);
  });

  it("400 when starred is not boolean", async () => {
    const res = await post({ entryIds: [1], starred: "yes" });
    expect(res.status).toBe(400);
  });
});
