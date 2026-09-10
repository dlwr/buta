import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { insertFeed } from "../../src/db/feeds";
import { insertNewEntries } from "../../src/db/entries";
import { listMarked, addMarks, removeMarks } from "../../src/db/marks";

let ids: number[];
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM feeds WHERE id > 0").run();
  const feedId = (await insertFeed(env.DB, { feedUrl: "https://a/feed", siteUrl: null, title: "A", createdAt: "t" })).id;
  ids = await insertNewEntries(env.DB, ["a", "b", "c"].map((k) => ({
    feedId, dedupKey: k, title: k, url: null, author: null, summary: null, content: null, published: "t", createdAt: "t",
  })));
});

describe("marks", () => {
  it("addMarks then listMarked returns the ids ascending", async () => {
    await addMarks(env.DB, "unread_entries", [ids[2]!, ids[0]!, ids[1]!]);
    expect(await listMarked(env.DB, "unread_entries")).toEqual([...ids].sort((a, b) => a - b));
  });

  it("addMarks is idempotent", async () => {
    await addMarks(env.DB, "starred_entries", [ids[0]!]);
    await addMarks(env.DB, "starred_entries", [ids[0]!]);
    expect(await listMarked(env.DB, "starred_entries")).toEqual([ids[0]]);
  });

  it("addMarks ignores ids that are not entries", async () => {
    await addMarks(env.DB, "starred_entries", [999_999]);
    expect(await listMarked(env.DB, "starred_entries")).toEqual([]);
  });

  it("removeMarks deletes only the given ids", async () => {
    await addMarks(env.DB, "unread_entries", ids);
    await removeMarks(env.DB, "unread_entries", [ids[1]!]);
    expect(await listMarked(env.DB, "unread_entries")).toEqual([ids[0], ids[2]]);
  });

  it("tables are independent", async () => {
    await addMarks(env.DB, "unread_entries", [ids[0]!]);
    expect(await listMarked(env.DB, "starred_entries")).toEqual([]);
  });
});
