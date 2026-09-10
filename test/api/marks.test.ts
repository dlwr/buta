import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { insertFeed } from "../../src/db/feeds";
import { insertNewEntries } from "../../src/db/entries";
import { listMarked, addMarks } from "../../src/db/marks";
import { call, jsonReq } from "./helpers";

let ids: number[];
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM feeds WHERE id > 0").run();
  const feedId = (await insertFeed(env.DB, { feedUrl: "https://a/feed", siteUrl: null, title: "A", createdAt: "t" })).id;
  ids = await insertNewEntries(env.DB, ["a", "b", "c"].map((k) => ({
    feedId, dedupKey: k, title: k, url: null, author: null, summary: null, content: null, published: "t", createdAt: "t",
  })));
});

for (const [path, key] of [
  ["/v2/unread_entries.json", "unread_entries"],
  ["/v2/starred_entries.json", "starred_entries"],
] as const) {
  describe(path, () => {
    it("GET lists marked ids", async () => {
      await addMarks(env.DB, key, [ids[0]!, ids[2]!]);
      expect(await (await call(path)).json()).toEqual([ids[0], ids[2]]);
    });

    it("POST marks and echoes the ids", async () => {
      const res = await call(path, jsonReq("POST", { [key]: [ids[1]] }));
      expect(await res.json()).toEqual([ids[1]]);
      expect(await listMarked(env.DB, key)).toEqual([ids[1]]);
    });

    it("DELETE with body unmarks", async () => {
      await addMarks(env.DB, key, ids);
      const res = await call(path, jsonReq("DELETE", { [key]: [ids[0]] }));
      expect(await res.json()).toEqual([ids[0]]);
      expect(await listMarked(env.DB, key)).toEqual([ids[1], ids[2]]);
    });

    it("POST to /delete.json also unmarks", async () => {
      await addMarks(env.DB, key, ids);
      await call(path.replace(".json", "/delete.json"), jsonReq("POST", { [key]: [ids[2]] }));
      expect(await listMarked(env.DB, key)).toEqual([ids[0], ids[1]]);
    });

    it("rejects a body without the expected key", async () => {
      expect((await call(path, jsonReq("POST", { nope: [1] }))).status).toBe(400);
    });

    it("rejects non-integer ids", async () => {
      expect((await call(path, jsonReq("POST", { [key]: ["x"] }))).status).toBe(400);
    });

    it("rejects more than 1000 ids", async () => {
      expect((await call(path, jsonReq("POST", { [key]: Array.from({ length: 1001 }, (_, i) => i) }))).status).toBe(400);
    });
  });
}
