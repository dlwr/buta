import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { insertFeed } from "../../src/db/feeds";
import { insertNewEntries } from "../../src/db/entries";
import { addMarks } from "../../src/db/marks";
import { call } from "./helpers";

let feedId: number; let ids: number[];
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM feeds WHERE id > 0").run();
  feedId = (await insertFeed(env.DB, { feedUrl: "https://a/feed", siteUrl: "https://a/", title: "A", createdAt: "t" })).id;
  ids = await insertNewEntries(env.DB, ["a", "b", "c"].map((k, i) => ({
    feedId, dedupKey: k, title: k, url: `https://a/${k}`, author: "au", summary: "s", content: "<p>c</p>",
    published: `2026-09-0${i + 1}T00:00:00.000Z`, createdAt: `2026-09-0${i + 1}T00:00:00.000Z`,
  })));
});

describe("GET /v2/entries.json", () => {
  it("returns entries newest first in Feedbin shape", async () => {
    const body = await (await call("/v2/entries.json")).json() as Record<string, unknown>[];
    expect(body.map((e) => e.title)).toEqual(["c", "b", "a"]);
    expect(body[0]).toEqual({
      id: ids[2], feed_id: feedId, title: "c", author: "au", summary: "s", content: "<p>c</p>", url: "https://a/c",
      extracted_content_url: null, extracted_articles: [], published: "2026-09-03T00:00:00.000Z",
      created_at: "2026-09-03T00:00:00.000Z", original: null, images: null, enclosure: null,
      twitter_id: null, twitter_thread_ids: [],
    });
  });

  it("paginates and emits a Links header Capy can parse", async () => {
    const res = await call("/v2/entries.json?per_page=2");
    expect((await res.json() as unknown[]).length).toBe(2);
    expect(res.headers.get("Links")).toBe(
      '<https://buta.test/v2/entries.json?per_page=2&page=2>; rel="next", <https://buta.test/v2/entries.json?per_page=2&page=2>; rel="last"',
    );
  });

  it("omits rel=next on the last page", async () => {
    const res = await call("/v2/entries.json?per_page=2&page=2");
    expect(res.headers.get("Links")).toBe('<https://buta.test/v2/entries.json?per_page=2&page=1>; rel="first"');
  });

  it("omits the Links header when everything fits on one page", async () => {
    expect((await call("/v2/entries.json")).headers.get("Links")).toBeNull();
  });

  it("filters by since", async () => {
    const body = await (await call("/v2/entries.json?since=2026-09-02T00:00:00.000Z")).json() as { title: string }[];
    expect(body.map((e) => e.title)).toEqual(["c"]);
  });

  it("normalizes a since value with microseconds like Feedbin's", async () => {
    const body = await (await call("/v2/entries.json?since=2026-09-02T00:00:00.000001Z")).json() as { title: string }[];
    expect(body.map((e) => e.title)).toEqual(["c"]);
  });

  it("filters by ids", async () => {
    const body = await (await call(`/v2/entries.json?ids=${ids[0]},${ids[2]}`)).json() as { title: string }[];
    expect(body.map((e) => e.title)).toEqual(["c", "a"]);
  });

  it("filters read=false to unread entries", async () => {
    await addMarks(env.DB, "unread_entries", [ids[1]!]);
    const body = await (await call("/v2/entries.json?read=false")).json() as { title: string }[];
    expect(body.map((e) => e.title)).toEqual(["b"]);
  });

  it("filters starred=true", async () => {
    await addMarks(env.DB, "starred_entries", [ids[0]!]);
    const body = await (await call("/v2/entries.json?starred=true")).json() as { title: string }[];
    expect(body.map((e) => e.title)).toEqual(["a"]);
  });

  it("caps per_page at 100", async () => {
    const res = await call("/v2/entries.json?per_page=1000");
    expect(res.status).toBe(200);
  });
});

describe("GET /v2/feeds/:id/entries.json", () => {
  it("returns only that feed's entries", async () => {
    const other = await insertFeed(env.DB, { feedUrl: "https://b/feed", siteUrl: null, title: "B", createdAt: "t" });
    await insertNewEntries(env.DB, [{ feedId: other.id, dedupKey: "z", title: "z", url: null, author: null, summary: null, content: null, published: "t", createdAt: "2026-09-09T00:00:00.000Z" }]);
    const body = await (await call(`/v2/feeds/${other.id}/entries.json`)).json() as { title: string }[];
    expect(body.map((e) => e.title)).toEqual(["z"]);
  });
});

describe("GET /v2/entries/:id.json", () => {
  it("returns one entry", async () => {
    const body = await (await call(`/v2/entries/${ids[0]}.json`)).json() as { title: string };
    expect(body.title).toBe("a");
  });
  it("404 for unknown id", async () => {
    expect((await call("/v2/entries/999999.json")).status).toBe(404);
  });
});
