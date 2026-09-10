import { describe, it, expect } from "vitest";
import { isBasicAuthorized, unauthorized } from "../../src/api/auth";

const req = (auth?: string) => new Request("https://b/v2/x", { headers: auth ? { Authorization: auth } : {} });
const basic = (u: string, p: string) => "Basic " + btoa(`${u}:${p}`);

describe("isBasicAuthorized", () => {
  it("accepts the configured email and password", () => {
    expect(isBasicAuthorized(req(basic("me@x", "pw")), "me@x", "pw")).toBe(true);
  });
  it("rejects a wrong password", () => {
    expect(isBasicAuthorized(req(basic("me@x", "nope")), "me@x", "pw")).toBe(false);
  });
  it("rejects a missing header", () => {
    expect(isBasicAuthorized(req(), "me@x", "pw")).toBe(false);
  });
  it("rejects a non-basic scheme", () => {
    expect(isBasicAuthorized(req("Bearer abc"), "me@x", "pw")).toBe(false);
  });
  it("rejects malformed base64", () => {
    expect(isBasicAuthorized(req("Basic %%%"), "me@x", "pw")).toBe(false);
  });
  it("fails closed when no password is configured", () => {
    expect(isBasicAuthorized(req(basic("me@x", "")), "me@x", "")).toBe(false);
  });
  it("allows a colon inside the password", () => {
    expect(isBasicAuthorized(req(basic("me@x", "a:b")), "me@x", "a:b")).toBe(true);
  });
});

describe("unauthorized", () => {
  it("is 401 with a Basic challenge", () => {
    const res = unauthorized();
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe('Basic realm="buta"');
  });
});
