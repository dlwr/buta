import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { insertFeed } from "../../src/db/feeds";
import { listTaggings, findTagging, insertTagging, deleteTagging, renameTag, deleteTag } from "../../src/db/taggings";

let f1: number; let f2: number;
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM feeds WHERE id > 0").run();
  f1 = (await insertFeed(env.DB, { feedUrl: "https://a/1", siteUrl: null, title: "1", createdAt: "t" })).id;
  f2 = (await insertFeed(env.DB, { feedUrl: "https://a/2", siteUrl: null, title: "2", createdAt: "t" })).id;
});

describe("taggings", () => {
  it("insertTagging returns a row with id", async () => {
    const t = await insertTagging(env.DB, f1, "News");
    expect(t).toMatchObject({ feed_id: f1, name: "News" });
    expect(t.id).toBeGreaterThan(0);
  });

  it("findTagging finds by feed and name", async () => {
    const t = await insertTagging(env.DB, f1, "News");
    expect((await findTagging(env.DB, f1, "News"))?.id).toBe(t.id);
  });

  it("listTaggings orders by id", async () => {
    const a = await insertTagging(env.DB, f1, "A");
    const b = await insertTagging(env.DB, f2, "A");
    const c = await insertTagging(env.DB, f1, "B");
    expect((await listTaggings(env.DB)).map((t) => t.id)).toEqual([a.id, b.id, c.id]);
  });

  it("deleteTagging returns false for unknown id", async () => {
    expect(await deleteTagging(env.DB, 9999)).toBe(false);
  });

  it("renameTag renames every tagging with that name", async () => {
    await insertTagging(env.DB, f1, "Old");
    await insertTagging(env.DB, f2, "Old");
    await renameTag(env.DB, "Old", "New");
    expect((await listTaggings(env.DB)).map((t) => t.name)).toEqual(["New", "New"]);
  });

  it("deleteTag removes every tagging with that name", async () => {
    await insertTagging(env.DB, f1, "Gone");
    await insertTagging(env.DB, f2, "Keep");
    await deleteTag(env.DB, "Gone");
    expect((await listTaggings(env.DB)).map((t) => t.name)).toEqual(["Keep"]);
  });
});
