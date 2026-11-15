import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import worker from "../../src/index";
import { readerToken } from "../../src/reader/auth";

describe("routing", () => {
  it("/health is public", async () => {
    expect((await worker.fetch(new Request("https://buta.test/health"), env)).status).toBe(200);
  });
  it("legacy /feed is gone", async () => {
    expect((await worker.fetch(new Request("https://buta.test/feed"), env)).status).toBe(404);
  });
  it("/v2 is 401 before routing", async () => {
    expect((await worker.fetch(new Request("https://buta.test/v2/entries.json"), env)).status).toBe(401);
  });
  it("/admin is 401 before routing", async () => {
    expect((await worker.fetch(new Request("https://buta.test/admin/crawl", { method: "POST" }), env)).status).toBe(401);
  });
  it("an exception in a handler becomes a 500 that carries the error message", async () => {
    const broken = { ...env, DB: { prepare() { throw new Error("D1_ERROR: boom"); } } as unknown as D1Database };
    const token = await readerToken("auth", env.API_EMAIL, env.API_PASSWORD);
    const res = await worker.fetch(
      new Request("https://buta.test/reader/api/0/tag/list", { headers: { Authorization: `GoogleLogin auth=${token}` } }), broken,
    );
    expect([res.status, await res.text()]).toEqual([500, "Error: D1_ERROR: boom"]);
  });
});
