import { describe, it, expect } from "vitest";
import { readerToken, isReaderAuthorized, parseClientLogin } from "../../src/reader/auth";

describe("readerToken", () => {
  it("is deterministic for the same inputs", async () => {
    expect(await readerToken("auth", "me@x", "pw")).toBe(await readerToken("auth", "me@x", "pw"));
  });
  it("differs by kind", async () => {
    expect(await readerToken("auth", "me@x", "pw")).not.toBe(await readerToken("write", "me@x", "pw"));
  });
  it("differs by password", async () => {
    expect(await readerToken("auth", "me@x", "pw")).not.toBe(await readerToken("auth", "me@x", "pw2"));
  });
  it("is hex", async () => {
    expect(await readerToken("auth", "me@x", "pw")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("isReaderAuthorized", () => {
  const req = (auth?: string) => new Request("https://b/reader/api/0/x", { headers: auth ? { Authorization: auth } : {} });
  it("accepts GoogleLogin auth=<token>", async () => {
    const t = await readerToken("auth", "me@x", "pw");
    expect(await isReaderAuthorized(req(`GoogleLogin auth=${t}`), "me@x", "pw")).toBe(true);
  });
  it("rejects a wrong token", async () => {
    expect(await isReaderAuthorized(req("GoogleLogin auth=deadbeef"), "me@x", "pw")).toBe(false);
  });
  it("rejects a missing header", async () => {
    expect(await isReaderAuthorized(req(), "me@x", "pw")).toBe(false);
  });
  it("fails closed without a configured password", async () => {
    const t = await readerToken("auth", "me@x", "pw");
    expect(await isReaderAuthorized(req(`GoogleLogin auth=${t}`), "me@x", "")).toBe(false);
  });
});

describe("parseClientLogin", () => {
  it("reads Email and Passwd from a form body", () => {
    expect(parseClientLogin("Email=me%40x&Passwd=p%26w")).toEqual({ email: "me@x", password: "p&w" });
  });
  it("returns null when a field is missing", () => {
    expect(parseClientLogin("Email=me%40x")).toBeNull();
  });
});
