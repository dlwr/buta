import { describe, it, expect } from "vitest";
import worker from "../src/index";

describe("worker fetch", () => {
  it("GET /health returns ok", async () => {
    const res = await worker.fetch(
      new Request("https://buta.example/health"),
      {} as never,
      {} as never,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("unknown path returns 404", async () => {
    const res = await worker.fetch(
      new Request("https://buta.example/nope"),
      {} as never,
      {} as never,
    );
    expect(res.status).toBe(404);
  });
});
