import { describe, it, expect } from "vitest";
import { parseFeedDocument } from "../../src/feeds/parse";

const RSS = `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>T</title><link>https://ex.com/</link>
<item><title>A</title><link>https://ex.com/a</link><guid isPermaLink="false">g1</guid><pubDate>Mon, 01 Sep 2026 10:00:00 GMT</pubDate><dc:creator>bob</dc:creator><description>sum</description><content:encoded><![CDATA[<p>full</p>]]></content:encoded><enclosure url="https://ex.com/a.mp3" type="audio/mpeg" length="1"/></item>
<item><title>NoGuid</title><link>https://ex.com/b</link></item>
<item><title>Bare</title><pubDate>Tue, 02 Sep 2026 10:00:00 GMT</pubDate></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>T</title><link rel="alternate" href="https://ex.com/"/>
<entry><id>tag:1</id><title>B</title><link rel="alternate" href="https://ex.com/b"/><published>2026-09-01T10:00:00Z</published><author><name>al</name></author><summary>s</summary><content type="html">&lt;p&gt;c&lt;/p&gt;</content></entry></feed>`;

const JSONFEED = JSON.stringify({ version: "https://jsonfeed.org/version/1.1", title: "T", home_page_url: "https://ex.com/",
  items: [{ id: "j1", url: "https://ex.com/j", title: "J", content_html: "<p>j</p>", summary: "js", date_published: "2026-09-01T10:00:00Z", authors: [{ name: "jo" }] }] });

describe("parseFeedDocument", () => {
  describe("rss", () => {
    const feed = parseFeedDocument(RSS);
    it("reads feed title", () => expect(feed.title).toBe("T"));
    it("reads site url", () => expect(feed.siteUrl).toBe("https://ex.com/"));
    it("uses guid as dedup key", () => expect(feed.items[0]?.dedupKey).toBe("g1"));
    it("falls back to link as dedup key", () => expect(feed.items[1]?.dedupKey).toBe("https://ex.com/b"));
    it("falls back to title+published as dedup key", () => expect(feed.items[2]?.dedupKey).toBe("Bare|2026-09-02T10:00:00.000Z"));
    it("prefers content:encoded as content", () => expect(feed.items[0]?.content).toBe("<p>full</p>"));
    it("uses description as summary", () => expect(feed.items[0]?.summary).toBe("sum"));
    it("uses dc:creator as author", () => expect(feed.items[0]?.author).toBe("bob"));
    it("normalizes pubDate to ISO", () => expect(feed.items[0]?.published).toBe("2026-09-01T10:00:00.000Z"));
    it("gives null published when absent", () => expect(feed.items[1]?.published).toBeNull());
    it("maps enclosure", () => expect(feed.items[0]?.enclosure).toEqual({ url: "https://ex.com/a.mp3", type: "audio/mpeg", length: "1" }));
  });

  describe("atom", () => {
    const feed = parseFeedDocument(ATOM);
    it("uses id as dedup key", () => expect(feed.items[0]?.dedupKey).toBe("tag:1"));
    it("uses alternate link as url", () => expect(feed.items[0]?.url).toBe("https://ex.com/b"));
    it("uses content as content", () => expect(feed.items[0]?.content).toBe("<p>c</p>"));
    it("uses author name", () => expect(feed.items[0]?.author).toBe("al"));
    it("reads site url from alternate link", () => expect(feed.siteUrl).toBe("https://ex.com/"));
  });

  describe("json feed", () => {
    const feed = parseFeedDocument(JSONFEED);
    it("uses id as dedup key", () => expect(feed.items[0]?.dedupKey).toBe("j1"));
    it("uses content_html as content", () => expect(feed.items[0]?.content).toBe("<p>j</p>"));
    it("uses first author name", () => expect(feed.items[0]?.author).toBe("jo"));
    it("uses home_page_url as site url", () => expect(feed.siteUrl).toBe("https://ex.com/"));
  });

  it("throws on non-feed input", () => {
    expect(() => parseFeedDocument("<html><body>nope</body></html>")).toThrow();
  });
});
