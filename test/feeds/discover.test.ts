import { describe, it, expect } from "vitest";
import { discoverFeedUrls, resolveFeed } from "../../src/feeds/discover";

const HTML = `<html><head>
<link rel="alternate" type="application/rss+xml" href="/feed.xml">
<link rel="alternate" type="application/atom+xml" href="https://ex.com/atom">
<link rel="alternate" type="application/feed+json" href="feed.json">
<link rel="stylesheet" href="/x.css">
</head></html>`;

describe("discoverFeedUrls", () => {
  it("returns feed links as absolute urls in document order", () => {
    expect(discoverFeedUrls(HTML, "https://ex.com/blog/")).toEqual([
      "https://ex.com/feed.xml", "https://ex.com/atom", "https://ex.com/blog/feed.json",
    ]);
  });
  it("returns empty when there are none", () => {
    expect(discoverFeedUrls("<html></html>", "https://ex.com/")).toEqual([]);
  });
});

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title></channel></rss>`;
function fetchWith(routes: Record<string, () => Response>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const h = routes[url];
    return h ? h() : new Response("nf", { status: 404 });
  }) as typeof fetch;
}

describe("resolveFeed", () => {
  it("returns the url itself when it is a feed", async () => {
    const r = await resolveFeed("https://ex.com/feed", fetchWith({ "https://ex.com/feed": () => new Response(RSS) }));
    expect(r).toEqual({ kind: "feed", feedUrl: "https://ex.com/feed", text: RSS });
  });
  it("follows the first discovered link when given html", async () => {
    const r = await resolveFeed("https://ex.com/", fetchWith({
      "https://ex.com/": () => new Response(HTML, { headers: { "Content-Type": "text/html" } }),
      "https://ex.com/feed.xml": () => new Response(RSS),
    }));
    expect(r).toMatchObject({ kind: "feed", feedUrl: "https://ex.com/feed.xml" });
  });
  it("returns none when html has no feed link", async () => {
    const r = await resolveFeed("https://ex.com/", fetchWith({ "https://ex.com/": () => new Response("<html></html>") }));
    expect(r).toEqual({ kind: "none" });
  });
  it("returns error on http failure", async () => {
    const r = await resolveFeed("https://ex.com/", fetchWith({}));
    expect(r).toEqual({ kind: "error", message: "HTTP 404" });
  });
});
