import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { env } from "cloudflare:test";
import { insertFeed, listFeeds, getFeed } from "../../src/db/feeds";
import { insertTagging, listTaggings } from "../../src/db/taggings";
import { readerCall, readerPost } from "./helpers";

let f1: number; let f2: number;
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM feeds WHERE id > 0").run();
  f1 = (await insertFeed(env.DB, { feedUrl: "https://a/1", siteUrl: "https://a/", title: "One", createdAt: "t" })).id;
  f2 = (await insertFeed(env.DB, { feedUrl: "https://a/2", siteUrl: null, title: "Two", createdAt: "t" })).id;
  await insertTagging(env.DB, f1, "News");
  await insertTagging(env.DB, f1, "Blog");
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("GET /reader/api/0/subscription/list", () => {
  it("lists feeds with categories", async () => {
    const body = await (await readerCall("/reader/api/0/subscription/list?output=json")).json();
    expect(body).toEqual({ subscriptions: [
      { id: `feed/${f1}`, title: "One", categories: [{ id: "user/-/label/News", label: "News" }, { id: "user/-/label/Blog", label: "Blog" }], url: "https://a/1", htmlUrl: "https://a/", iconUrl: "" },
      { id: `feed/${f2}`, title: "Two", categories: [], url: "https://a/2", htmlUrl: "", iconUrl: "" },
    ] });
  });
});

describe("POST /reader/api/0/subscription/edit", () => {
  it("ac=edit with t renames", async () => {
    await readerPost("/reader/api/0/subscription/edit", { s: `feed/${f2}`, ac: "edit", t: "Deux" });
    expect((await getFeed(env.DB, f2))?.title).toBe("Deux");
  });
  it("ac=edit with a adds a label", async () => {
    await readerPost("/reader/api/0/subscription/edit", { s: `feed/${f2}`, ac: "edit", a: "user/-/label/News" });
    expect((await listTaggings(env.DB)).filter((t) => t.feed_id === f2).map((t) => t.name)).toEqual(["News"]);
  });
  it("ac=edit with r removes a label", async () => {
    await readerPost("/reader/api/0/subscription/edit", { s: `feed/${f1}`, ac: "edit", r: "user/-/label/News" });
    expect((await listTaggings(env.DB)).filter((t) => t.feed_id === f1).map((t) => t.name)).toEqual(["Blog"]);
  });
  it("ac=edit with r and a moves between labels", async () => {
    await readerPost("/reader/api/0/subscription/edit", { s: `feed/${f1}`, ac: "edit", r: "user/-/label/Blog", a: "user/-/label/Tech" });
    expect((await listTaggings(env.DB)).filter((t) => t.feed_id === f1).map((t) => t.name)).toEqual(["News", "Tech"]);
  });
  it("ac=unsubscribe deletes the feed", async () => {
    await readerPost("/reader/api/0/subscription/edit", { s: `feed/${f2}`, ac: "unsubscribe" });
    expect((await listFeeds(env.DB)).map((f) => f.id)).toEqual([f1]);
  });
  it("404 for an unknown feed", async () => {
    expect((await readerPost("/reader/api/0/subscription/edit", { s: "feed/999", ac: "edit", t: "x" })).status).toBe(404);
  });
});

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Remote</title><link>https://r/</link><item><guid>1</guid><title>x</title></item></channel></rss>`;

describe("POST /reader/api/0/subscription/quickadd", () => {
  it("subscribes and returns streamId", async () => {
    vi.stubGlobal("fetch", async () => new Response(RSS));
    const body = await (await readerPost("/reader/api/0/subscription/quickadd", { quickadd: "https://r/feed" })).json() as { numResults: number; streamId: string; streamName: string };
    expect(body.numResults).toBe(1);
    expect(body.streamName).toBe("Remote");
    const feed = (await listFeeds(env.DB)).find((f) => f.feed_url === "https://r/feed")!;
    expect(body.streamId).toBe(`feed/${feed.id}`);
  });
  it("returns the existing streamId when already subscribed", async () => {
    const body = await (await readerPost("/reader/api/0/subscription/quickadd", { quickadd: "https://a/1" })).json() as { numResults: number; streamId: string };
    expect(body).toMatchObject({ numResults: 1, streamId: `feed/${f1}` });
  });
  it("returns numResults 0 with an error when nothing is found", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html></html>"));
    const body = await (await readerPost("/reader/api/0/subscription/quickadd", { quickadd: "https://r/" })).json() as { numResults: number; error: string };
    expect(body.numResults).toBe(0);
    expect(body.error).toBeTruthy();
  });
});
