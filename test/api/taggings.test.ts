import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { insertFeed } from "../../src/db/feeds";
import { insertTagging, listTaggings } from "../../src/db/taggings";
import { call, jsonReq } from "./helpers";

let f1: number; let f2: number;
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM feeds WHERE id > 0").run();
  f1 = (await insertFeed(env.DB, { feedUrl: "https://a/1", siteUrl: null, title: "1", createdAt: "t" })).id;
  f2 = (await insertFeed(env.DB, { feedUrl: "https://a/2", siteUrl: null, title: "2", createdAt: "t" })).id;
});

describe("taggings", () => {
  it("GET lists taggings", async () => {
    const t = await insertTagging(env.DB, f1, "News");
    expect(await (await call("/v2/taggings.json")).json()).toEqual([{ id: t.id, feed_id: f1, name: "News" }]);
  });

  it("POST creates a tagging and accepts feed_id as a string", async () => {
    const res = await call("/v2/taggings.json", jsonReq("POST", { feed_id: String(f1), name: "News" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ feed_id: f1, name: "News" });
  });

  it("POST returns 302 to the existing tagging when it already exists", async () => {
    const t = await insertTagging(env.DB, f1, "News");
    const res = await call("/v2/taggings.json", jsonReq("POST", { feed_id: f1, name: "News" }));
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(`https://buta.test/v2/taggings/${t.id}.json`);
  });

  it("POST 404 for unknown feed", async () => {
    expect((await call("/v2/taggings.json", jsonReq("POST", { feed_id: 999, name: "X" }))).status).toBe(404);
  });

  it("POST 400 without a name", async () => {
    expect((await call("/v2/taggings.json", jsonReq("POST", { feed_id: f1 }))).status).toBe(400);
  });

  it("GET /v2/taggings/:id.json returns one tagging", async () => {
    const t = await insertTagging(env.DB, f1, "News");
    expect(await (await call(`/v2/taggings/${t.id}.json`)).json()).toEqual({ id: t.id, feed_id: f1, name: "News" });
  });

  it("DELETE removes a tagging", async () => {
    const t = await insertTagging(env.DB, f1, "News");
    expect((await call(`/v2/taggings/${t.id}.json`, { method: "DELETE" })).status).toBe(204);
    expect(await listTaggings(env.DB)).toEqual([]);
  });
});

describe("tags", () => {
  it("POST /v2/tags.json renames and returns the taggings", async () => {
    await insertTagging(env.DB, f1, "Old");
    await insertTagging(env.DB, f2, "Old");
    const res = await call("/v2/tags.json", jsonReq("POST", { old_name: "Old", new_name: "New" }));
    expect((await res.json() as { name: string }[]).map((t) => t.name)).toEqual(["New", "New"]);
  });

  it("DELETE /v2/tags.json removes the tag and returns remaining taggings", async () => {
    await insertTagging(env.DB, f1, "Gone");
    await insertTagging(env.DB, f2, "Keep");
    const res = await call("/v2/tags.json", jsonReq("DELETE", { name: "Gone" }));
    expect((await res.json() as { name: string }[]).map((t) => t.name)).toEqual(["Keep"]);
  });
});
