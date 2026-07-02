import { describe, it, expect } from "vitest";
import worker from "../src/index";

const baseEnv = {
  DB: {} as never, SYNC_KV: {} as never,
  FEEDBIN_EMAIL: "", FEEDBIN_PASSWORD: "", ADMIN_TOKEN: "secret",
};

describe("POST /admin/sync auth", () => {
  it("401 without a valid token", async () => {
    const res = await worker.fetch(
      new Request("https://buta.example/admin/sync", { method: "POST" }),
      baseEnv as never, {} as never,
    );
    expect(res.status).toBe(401);
  });

  it("rejects a wrong token", async () => {
    const res = await worker.fetch(
      new Request("https://buta.example/admin/sync", {
        method: "POST", headers: { Authorization: "Bearer nope" },
      }),
      baseEnv as never, {} as never,
    );
    expect(res.status).toBe(401);
  });
});
