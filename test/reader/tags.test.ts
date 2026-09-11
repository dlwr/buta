import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { insertFeed } from "../../src/db/feeds";
import { insertTagging, listTaggings } from "../../src/db/taggings";
import { readerCall, readerPost } from "./helpers";

let f1: number; let f2: number;
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM feeds WHERE id > 0").run();
  f1 = (await insertFeed(env.DB, { feedUrl: "https://a/1", siteUrl: null, title: "One", createdAt: "t" })).id;
  f2 = (await insertFeed(env.DB, { feedUrl: "https://a/2", siteUrl: null, title: "Two", createdAt: "t" })).id;
  await insertTagging(env.DB, f1, "News");
  await insertTagging(env.DB, f2, "News");
  await insertTagging(env.DB, f2, "Blog");
});

describe("GET /reader/api/0/tag/list", () => {
  it("lists starred state and distinct folders", async () => {
    const body = await (await readerCall("/reader/api/0/tag/list?output=json")).json();
    expect(body).toEqual({ tags: [
      { id: "user/-/state/com.google/starred", type: "tag" },
      { id: "user/-/label/News", type: "folder" },
      { id: "user/-/label/Blog", type: "folder" },
    ] });
  });
});

describe("POST /reader/api/0/rename-tag", () => {
  it("renames every tagging with that label", async () => {
    const res = await readerPost("/reader/api/0/rename-tag", { s: "user/-/label/News", dest: "user/-/label/Press" });
    expect(await res.text()).toBe("OK");
    expect((await listTaggings(env.DB)).map((t) => t.name)).toEqual(["Press", "Press", "Blog"]);
  });
});

describe("POST /reader/api/0/disable-tag", () => {
  it("removes every tagging with that label", async () => {
    await readerPost("/reader/api/0/disable-tag", { s: "user/-/label/News" });
    expect((await listTaggings(env.DB)).map((t) => t.name)).toEqual(["Blog"]);
  });
});
