import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { insertFeed } from "../../src/db/feeds";
import { insertNewEntries } from "../../src/db/entries";
import { insertTagging } from "../../src/db/taggings";
import { addMarks, listMarked } from "../../src/db/marks";
import { toLongItemId } from "../../src/reader/ids";
import { readerCall, readerPost } from "./helpers";

let f1: number; let ids: number[];
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM feeds WHERE id > 0").run();
  f1 = (await insertFeed(env.DB, { feedUrl: "https://a/1", siteUrl: "https://a/", title: "One", createdAt: "t" })).id;
  await insertTagging(env.DB, f1, "News");
  ids = await insertNewEntries(env.DB, ["a", "b", "c"].map((k, i) => ({
    feedId: f1, dedupKey: k, title: k, url: `https://a/${k}`, author: "au", summary: "sum", content: `<p>${k}</p>`,
    published: `2026-09-0${i + 1}T00:00:00.000Z`, createdAt: `2026-09-0${i + 1}T00:00:00.000Z`,
  })));
  await addMarks(env.DB, "unread_entries", [ids[0]!, ids[2]!]);
  await addMarks(env.DB, "starred_entries", [ids[1]!]);
});

const READ = "user/-/state/com.google/read";
const STARRED = "user/-/state/com.google/starred";
const LIST = "user/-/state/com.google/reading-list";

describe("GET /reader/api/0/stream/items/ids", () => {
  it("lists reading-list ids newest first as decimal strings", async () => {
    const body = await (await readerCall(`/reader/api/0/stream/items/ids?s=${LIST}&n=1000&output=json`)).json() as { itemRefs: { id: string }[] };
    expect(body.itemRefs.map((r) => r.id)).toEqual([String(ids[2]), String(ids[1]), String(ids[0])]);
  });
  it("excludes read items with xt=read", async () => {
    const body = await (await readerCall(`/reader/api/0/stream/items/ids?s=${LIST}&xt=${READ}&n=1000`)).json() as { itemRefs: { id: string }[] };
    expect(body.itemRefs.map((r) => r.id)).toEqual([String(ids[2]), String(ids[0])]);
  });
  it("lists starred items", async () => {
    const body = await (await readerCall(`/reader/api/0/stream/items/ids?s=${STARRED}&n=1000`)).json() as { itemRefs: { id: string }[] };
    expect(body.itemRefs.map((r) => r.id)).toEqual([String(ids[1])]);
  });
  it("lists one feed", async () => {
    const other = await insertFeed(env.DB, { feedUrl: "https://b/1", siteUrl: null, title: "B", createdAt: "t" });
    const [z] = await insertNewEntries(env.DB, [{ feedId: other.id, dedupKey: "z", title: "z", url: null, author: null, summary: null, content: null, published: "t", createdAt: "2026-09-09T00:00:00.000Z" }]);
    const body = await (await readerCall(`/reader/api/0/stream/items/ids?s=feed/${other.id}&n=1000`)).json() as { itemRefs: { id: string }[] };
    expect(body.itemRefs.map((r) => r.id)).toEqual([String(z)]);
  });
  it("filters by ot (unix seconds, inclusive, on crawl time)", async () => {
    const ot = Math.floor(Date.parse("2026-09-02T00:00:00.000Z") / 1000);
    const body = await (await readerCall(`/reader/api/0/stream/items/ids?s=${LIST}&ot=${ot}&n=1000`)).json() as { itemRefs: { id: string }[] };
    expect(body.itemRefs.map((r) => r.id)).toEqual([String(ids[2]), String(ids[1])]);
  });
  it("pages with continuation", async () => {
    const first = await (await readerCall(`/reader/api/0/stream/items/ids?s=${LIST}&n=2`)).json() as { itemRefs: { id: string }[]; continuation?: string };
    expect(first.itemRefs).toHaveLength(2);
    expect(first.continuation).toBe("2");
    const second = await (await readerCall(`/reader/api/0/stream/items/ids?s=${LIST}&n=2&c=${first.continuation}`)).json() as { itemRefs: { id: string }[]; continuation?: string };
    expect(second.itemRefs.map((r) => r.id)).toEqual([String(ids[0])]);
    expect(second.continuation).toBeUndefined();
  });
  it("400 for an unknown stream", async () => {
    expect((await readerCall("/reader/api/0/stream/items/ids?s=user/-/label/News")).status).toBe(400);
  });
});

describe("POST /reader/api/0/stream/items/contents", () => {
  it("returns items in Reader shape with state categories and labels", async () => {
    const res = await readerPost("/reader/api/0/stream/items/contents", { output: "json", i: [toLongItemId(ids[1]!), toLongItemId(ids[0]!)] });
    const body = await res.json() as { id: string; updated: number; items: Record<string, unknown>[] };
    expect(body.id).toBe(LIST);
    expect(body.items.map((i) => i.id)).toEqual([toLongItemId(ids[1]!), toLongItemId(ids[0]!)]);
    expect(body.items[0]).toEqual({
      id: toLongItemId(ids[1]!),
      crawlTimeMsec: String(Date.parse("2026-09-02T00:00:00.000Z")),
      timestampUsec: String(Date.parse("2026-09-02T00:00:00.000Z") * 1000),
      published: Math.floor(Date.parse("2026-09-02T00:00:00.000Z") / 1000),
      updated: Math.floor(Date.parse("2026-09-02T00:00:00.000Z") / 1000),
      title: "b", author: "au",
      summary: { direction: "ltr", content: "<p>b</p>" },
      alternate: [{ href: "https://a/b", type: "text/html" }],
      categories: [LIST, READ, STARRED, "user/-/label/News"],
      origin: { streamId: `feed/${f1}`, title: "One", htmlUrl: "https://a/" },
    });
  });
  it("accepts bare decimal ids", async () => {
    const res = await readerPost("/reader/api/0/stream/items/contents", { i: String(ids[0]) });
    expect((await res.json() as { items: unknown[] }).items).toHaveLength(1);
  });
  it("falls back to summary when content is empty", async () => {
    const [id] = await insertNewEntries(env.DB, [{ feedId: f1, dedupKey: "s", title: "s", url: null, author: null, summary: "only summary", content: null, published: "t", createdAt: "t" }]);
    const res = await readerPost("/reader/api/0/stream/items/contents", { i: String(id) });
    expect((await res.json() as { items: { summary: { content: string } }[] }).items[0]?.summary.content).toBe("only summary");
  });
  it("401 with a bad write token", async () => {
    const res = await readerCall("/reader/api/0/stream/items/contents", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "T=bad&i=1" });
    expect(res.status).toBe(401);
  });
});

describe("POST /reader/api/0/edit-tag", () => {
  it("a=read marks read", async () => {
    await readerPost("/reader/api/0/edit-tag", { i: [toLongItemId(ids[0]!), toLongItemId(ids[2]!)], a: READ });
    expect(await listMarked(env.DB, "unread_entries")).toEqual([]);
  });
  it("r=read marks unread", async () => {
    await readerPost("/reader/api/0/edit-tag", { i: toLongItemId(ids[1]!), r: READ });
    expect(await listMarked(env.DB, "unread_entries")).toEqual([ids[0], ids[1], ids[2]]);
  });
  it("a=starred stars", async () => {
    await readerPost("/reader/api/0/edit-tag", { i: toLongItemId(ids[0]!), a: STARRED });
    expect(await listMarked(env.DB, "starred_entries")).toEqual([ids[0], ids[1]]);
  });
  it("r=starred unstars", async () => {
    await readerPost("/reader/api/0/edit-tag", { i: toLongItemId(ids[1]!), r: STARRED });
    expect(await listMarked(env.DB, "starred_entries")).toEqual([]);
  });
  it("responds OK", async () => {
    const res = await readerPost("/reader/api/0/edit-tag", { i: toLongItemId(ids[0]!), a: READ });
    expect(await res.text()).toBe("OK");
  });
});
