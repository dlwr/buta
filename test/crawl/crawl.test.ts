import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { insertFeed, getFeed, recordFetchFailure } from "../../src/db/feeds";
import { listMarked } from "../../src/db/marks";
import { queryEntries } from "../../src/db/entries";
import { crawlAllFeeds, crawlFeed, CRAWL_LOCK_KEY } from "../../src/crawl/crawl";

const RSS = (items: string) => `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title><link>https://ex.com/</link>${items}</channel></rss>`;
const item = (k: string) => `<item><title>${k}</title><link>https://ex.com/${k}</link><guid>${k}</guid><pubDate>Mon, 01 Sep 2026 10:00:00 GMT</pubDate></item>`;

function fetchWith(routes: Record<string, () => Response>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const h = routes[url];
    if (!h) throw new Error(`unexpected ${url}`);
    return h();
  }) as typeof fetch;
}

const NOW = "2026-09-10T00:00:00.000Z";
const deps = (fetchFn: typeof fetch) => ({ db: env.DB, kv: env.SYNC_KV, fetchFn, now: () => NOW });
const feedInput = (url: string) => ({ feedUrl: url, siteUrl: null, title: "T", createdAt: NOW });

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM feeds WHERE id > 0").run();
  await env.SYNC_KV.delete(CRAWL_LOCK_KEY);
});

describe("crawlFeed", () => {
  it("inserts new items and marks them unread", async () => {
    const feed = await insertFeed(env.DB, feedInput("https://ex.com/feed"));
    const r = await crawlFeed(deps(fetchWith({ "https://ex.com/feed": () => new Response(RSS(item("a") + item("b"))) })), feed);
    expect(r).toEqual({ outcome: "fetched", newEntries: 2 });
    expect(await listMarked(env.DB, "unread_entries")).toHaveLength(2);
  });

  it("does not re-insert already seen items", async () => {
    const feed = await insertFeed(env.DB, feedInput("https://ex.com/feed"));
    const d = deps(fetchWith({ "https://ex.com/feed": () => new Response(RSS(item("a"))) }));
    await crawlFeed(d, feed);
    const r = await crawlFeed(d, feed);
    expect(r.newEntries).toBe(0);
  });

  it("uses crawl time as published when the item has none", async () => {
    const feed = await insertFeed(env.DB, feedInput("https://ex.com/feed"));
    await crawlFeed(deps(fetchWith({ "https://ex.com/feed": () => new Response(RSS("<item><title>x</title><guid>x</guid></item>")) })), feed);
    const { rows } = await queryEntries(env.DB, { page: 1, perPage: 10 });
    expect(rows[0]?.published).toBe(NOW);
  });

  it("stores etag on success", async () => {
    const feed = await insertFeed(env.DB, feedInput("https://ex.com/feed"));
    await crawlFeed(deps(fetchWith({ "https://ex.com/feed": () => new Response(RSS(""), { headers: { ETag: '"e"' } }) })), feed);
    expect((await getFeed(env.DB, feed.id))?.etag).toBe('"e"');
  });

  it("reports not-modified on 304 without touching entries", async () => {
    const feed = await insertFeed(env.DB, feedInput("https://ex.com/feed"));
    const r = await crawlFeed(deps(fetchWith({ "https://ex.com/feed": () => new Response(null, { status: 304 }) })), feed);
    expect(r).toEqual({ outcome: "not-modified", newEntries: 0 });
  });

  it("records failure on HTTP error", async () => {
    const feed = await insertFeed(env.DB, feedInput("https://ex.com/feed"));
    const r = await crawlFeed(deps(fetchWith({ "https://ex.com/feed": () => new Response("x", { status: 500 }) })), feed);
    expect(r.outcome).toBe("failed");
    expect(await getFeed(env.DB, feed.id)).toMatchObject({ error_count: 1, last_error: "HTTP 500" });
  });

  it("records failure when the body is not a feed", async () => {
    const feed = await insertFeed(env.DB, feedInput("https://ex.com/feed"));
    const r = await crawlFeed(deps(fetchWith({ "https://ex.com/feed": () => new Response("<html/>") })), feed);
    expect(r.outcome).toBe("failed");
  });
});

describe("crawlAllFeeds", () => {
  it("crawls every feed and sums the result", async () => {
    await insertFeed(env.DB, feedInput("https://ex.com/1"));
    await insertFeed(env.DB, feedInput("https://ex.com/2"));
    const s = await crawlAllFeeds(deps(fetchWith({
      "https://ex.com/1": () => new Response(RSS(item("a"))),
      "https://ex.com/2": () => new Response(null, { status: 304 }),
    })));
    expect(s).toEqual({ fetched: 1, notModified: 1, skipped: 0, failed: 0, newEntries: 1 });
  });

  it("skips a feed that failed recently, with backoff growing by error_count", async () => {
    const f = await insertFeed(env.DB, feedInput("https://ex.com/1"));
    await recordFetchFailure(env.DB, f.id, { message: "x", fetchedAt: "2026-09-09T23:50:00.000Z" });
    await recordFetchFailure(env.DB, f.id, { message: "x", fetchedAt: "2026-09-09T23:50:00.000Z" });
    const s = await crawlAllFeeds(deps(fetchWith({})));
    expect(s?.skipped).toBe(1);
  });

  it("retries a failed feed once the backoff has elapsed", async () => {
    const f = await insertFeed(env.DB, feedInput("https://ex.com/1"));
    await recordFetchFailure(env.DB, f.id, { message: "x", fetchedAt: "2026-09-09T23:00:00.000Z" });
    const s = await crawlAllFeeds(deps(fetchWith({ "https://ex.com/1": () => new Response(RSS("")) })));
    expect(s?.fetched).toBe(1);
  });

  it("returns null when another crawl holds the lock", async () => {
    await env.SYNC_KV.put(CRAWL_LOCK_KEY, "1");
    expect(await crawlAllFeeds(deps(fetchWith({})))).toBeNull();
  });

  it("releases the lock when done", async () => {
    await crawlAllFeeds(deps(fetchWith({})));
    expect(await env.SYNC_KV.get(CRAWL_LOCK_KEY)).toBeNull();
  });
});

describe("crawlFeed deadline", () => {
  it("records a timeout failure when the fetch never settles", async () => {
    const feed = await insertFeed(env.DB, feedInput("https://ex.com/hang"));
    const never = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const r = await crawlFeed({ ...deps(never), feedDeadlineMs: 20 }, feed);
    expect(r.outcome).toBe("failed");
    expect((await getFeed(env.DB, feed.id))?.last_error).toBe("timeout");
  });
});

describe("crawlFeed insert filtering", () => {
  it("inserts only the items not already stored when a feed partially overlaps", async () => {
    const feed = await insertFeed(env.DB, feedInput("https://ex.com/feed"));
    await crawlFeed(deps(fetchWith({ "https://ex.com/feed": () => new Response(RSS(item("a"))) })), feed);
    const r = await crawlFeed(deps(fetchWith({ "https://ex.com/feed": () => new Response(RSS(item("a") + item("b"))) })), feed);
    expect(r.newEntries).toBe(1);
    expect(await listMarked(env.DB, "unread_entries")).toHaveLength(2);
  });
});
