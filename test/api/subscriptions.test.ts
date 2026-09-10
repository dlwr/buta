import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { env } from "cloudflare:test";
import { insertFeed, listFeeds } from "../../src/db/feeds";
import { call, jsonReq } from "./helpers";

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Remote Title</title><link>https://r/</link><item><guid>1</guid><title>x</title></item></channel></rss>`;

beforeEach(async () => { await env.DB.prepare("DELETE FROM feeds WHERE id > 0").run(); });
afterEach(() => { vi.unstubAllGlobals(); });

const post = (feed_url: string) => call("/v2/subscriptions.json", jsonReq("POST", { feed_url }));

describe("GET /v2/subscriptions.json", () => {
  it("lists subscriptions in Feedbin shape", async () => {
    const f = await insertFeed(env.DB, { feedUrl: "https://a/feed", siteUrl: "https://a/", title: "A", createdAt: "t" });
    expect(await (await call("/v2/subscriptions.json")).json()).toEqual([
      { id: f.id, created_at: "t", feed_id: f.id, title: "A", feed_url: "https://a/feed", site_url: "https://a/" },
    ]);
  });
});

describe("GET /v2/subscriptions/:id.json", () => {
  it("returns one subscription", async () => {
    const f = await insertFeed(env.DB, { feedUrl: "https://a/feed", siteUrl: null, title: "A", createdAt: "t" });
    expect((await (await call(`/v2/subscriptions/${f.id}.json`)).json() as { title: string }).title).toBe("A");
  });
  it("404 for unknown id", async () => {
    expect((await call("/v2/subscriptions/999.json")).status).toBe(404);
  });
});

describe("POST /v2/subscriptions.json", () => {
  it("creates a feed from a feed url, with title from the feed, and crawls it", async () => {
    vi.stubGlobal("fetch", async () => new Response(RSS));
    const res = await post("https://r/feed");
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ title: "Remote Title", feed_url: "https://r/feed", site_url: "https://r/" });
    const unread = await (await call("/v2/unread_entries.json")).json() as number[];
    expect(unread).toHaveLength(1);
  });

  it("returns 302 with the existing subscription when already subscribed", async () => {
    const f = await insertFeed(env.DB, { feedUrl: "https://r/feed", siteUrl: null, title: "A", createdAt: "t" });
    const res = await post("https://r/feed");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(`https://buta.test/v2/subscriptions/${f.id}.json`);
  });

  it("404 when no feed can be found", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html></html>"));
    expect((await post("https://r/")).status).toBe(404);
  });

  it("400 without feed_url", async () => {
    expect((await call("/v2/subscriptions.json", jsonReq("POST", {}))).status).toBe(400);
  });
});

describe("PATCH /v2/subscriptions/:id.json", () => {
  it("renames the subscription", async () => {
    const f = await insertFeed(env.DB, { feedUrl: "https://a/feed", siteUrl: null, title: "A", createdAt: "t" });
    const res = await call(`/v2/subscriptions/${f.id}.json`, jsonReq("PATCH", { title: "B" }));
    expect(res.status).toBe(200);
    expect((await res.json() as { title: string }).title).toBe("B");
  });
  it("404 for unknown id", async () => {
    expect((await call("/v2/subscriptions/999.json", jsonReq("PATCH", { title: "B" }))).status).toBe(404);
  });
});

describe("DELETE /v2/subscriptions/:id.json", () => {
  it("deletes the feed", async () => {
    const f = await insertFeed(env.DB, { feedUrl: "https://a/feed", siteUrl: null, title: "A", createdAt: "t" });
    expect((await call(`/v2/subscriptions/${f.id}.json`, { method: "DELETE" })).status).toBe(204);
    expect(await listFeeds(env.DB)).toEqual([]);
  });
  it("404 for unknown id", async () => {
    expect((await call("/v2/subscriptions/999.json", { method: "DELETE" })).status).toBe(404);
  });
});
