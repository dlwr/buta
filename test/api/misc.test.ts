import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import worker from "../../src/index";
import { call } from "./helpers";

describe("misc endpoints", () => {
  it("authentication.json returns 200 with valid credentials", async () => {
    expect((await call("/v2/authentication.json")).status).toBe(200);
  });
  it("authentication.json returns 401 without credentials", async () => {
    const res = await worker.fetch(new Request("https://buta.test/v2/authentication.json"), env);
    expect(res.status).toBe(401);
  });
  it("icons.json returns an empty list", async () => {
    expect(await (await call("/v2/icons.json")).json()).toEqual([]);
  });
  it("saved_searches.json returns an empty list", async () => {
    expect(await (await call("/v2/saved_searches.json")).json()).toEqual([]);
  });
  it("pages.json is not implemented", async () => {
    expect((await call("/v2/pages.json", { method: "POST" })).status).toBe(501);
  });
  it("unknown /v2 path is 404 after auth", async () => {
    expect((await call("/v2/nope.json")).status).toBe(404);
  });
});
