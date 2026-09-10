import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import worker from "../../src/index";
import { listFeeds } from "../../src/db/feeds";
import { listTaggings } from "../../src/db/taggings";
import { importOpml } from "../../src/admin/import-opml";

const OPML = `<?xml version="1.0"?><opml version="2.0"><body>
<outline text="Must Read"><outline type="rss" text="F1" title="F1" xmlUrl="https://ex.com/1" htmlUrl="https://ex.com/"/></outline>
<outline text="Blog"><outline type="rss" text="F1 again" xmlUrl="https://ex.com/1"/><outline type="rss" text="F2" xmlUrl="https://ex.com/2"/></outline>
<outline type="rss" text="Top" xmlUrl="https://ex.com/top"/>
</body></opml>`;

beforeEach(async () => { await env.DB.prepare("DELETE FROM feeds WHERE id > 0").run(); });

describe("importOpml", () => {
  it("adds one feed per distinct xmlUrl", async () => {
    const r = await importOpml(env.DB, OPML, "t");
    expect(r.feedsAdded).toBe(3);
    expect((await listFeeds(env.DB)).map((f) => f.feed_url)).toEqual(["https://ex.com/1", "https://ex.com/2", "https://ex.com/top"]);
  });

  it("uses title, then text, then url as the feed title", async () => {
    await importOpml(env.DB, OPML, "t");
    expect((await listFeeds(env.DB)).map((f) => f.title)).toEqual(["F1", "F2", "Top"]);
  });

  it("stores htmlUrl as site_url", async () => {
    await importOpml(env.DB, OPML, "t");
    expect((await listFeeds(env.DB))[0]?.site_url).toBe("https://ex.com/");
  });

  it("creates a tagging per folder membership, so one feed can be in two folders", async () => {
    await importOpml(env.DB, OPML, "t");
    const f1 = (await listFeeds(env.DB)).find((f) => f.feed_url === "https://ex.com/1")!;
    expect((await listTaggings(env.DB)).filter((t) => t.feed_id === f1.id).map((t) => t.name)).toEqual(["Must Read", "Blog"]);
  });

  it("does not tag a top-level feed", async () => {
    await importOpml(env.DB, OPML, "t");
    const top = (await listFeeds(env.DB)).find((f) => f.feed_url === "https://ex.com/top")!;
    expect((await listTaggings(env.DB)).filter((t) => t.feed_id === top.id)).toEqual([]);
  });

  it("is idempotent", async () => {
    await importOpml(env.DB, OPML, "t");
    const r = await importOpml(env.DB, OPML, "t");
    expect(r).toEqual({ feedsAdded: 0, feedsSkipped: 3, taggingsAdded: 0 });
  });
});

describe("POST /admin/opml", () => {
  it("requires the admin token", async () => {
    const res = await worker.fetch(new Request("https://buta.test/admin/opml", { method: "POST", body: OPML }), env);
    expect(res.status).toBe(401);
  });
  it("imports the posted body", async () => {
    const res = await worker.fetch(new Request("https://buta.test/admin/opml", {
      method: "POST", body: OPML, headers: { Authorization: "Bearer test-token" },
    }), env);
    expect(await res.json()).toEqual({ feedsAdded: 3, feedsSkipped: 0, taggingsAdded: 3 });
  });
});
