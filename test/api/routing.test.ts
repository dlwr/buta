import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import worker from "../../src/index";

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
});
