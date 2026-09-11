import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import worker from "../../src/index";
import { readerToken } from "../../src/reader/auth";
import { readerCall } from "./helpers";

const login = (email: string, password: string) => worker.fetch(new Request("https://buta.test/accounts/ClientLogin", {
  method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ Email: email, Passwd: password }).toString(),
}), env);

describe("POST /accounts/ClientLogin", () => {
  it("returns Auth=<token> lines for valid credentials", async () => {
    const res = await login("me@example.com", "pw");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain(`Auth=${await readerToken("auth", "me@example.com", "pw")}\n`);
    expect(text).toMatch(/^SID=/);
  });
  it("403 for wrong credentials", async () => {
    const res = await login("me@example.com", "nope");
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("Error=BadAuthentication");
  });
});

describe("GET /reader/api/0/token", () => {
  it("returns the write token", async () => {
    const res = await readerCall("/reader/api/0/token");
    expect(await res.text()).toBe(await readerToken("write", "me@example.com", "pw"));
  });
  it("401 without GoogleLogin auth", async () => {
    const res = await worker.fetch(new Request("https://buta.test/reader/api/0/token"), env);
    expect(res.status).toBe(401);
  });
});
