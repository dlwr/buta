import { describe, it, expect } from "vitest";
import { isAdminAuthorized } from "../../src/admin/auth";

const req = (auth?: string) => new Request("https://b/admin/x", { headers: auth ? { Authorization: auth } : {} });

describe("isAdminAuthorized", () => {
  it("accepts the configured bearer token", () => {
    expect(isAdminAuthorized(req("Bearer secret"), "secret")).toBe(true);
  });
  it("rejects a wrong token", () => {
    expect(isAdminAuthorized(req("Bearer nope"), "secret")).toBe(false);
  });
  it("rejects a missing header", () => {
    expect(isAdminAuthorized(req(), "secret")).toBe(false);
  });
  it("fails closed when no token is configured", () => {
    expect(isAdminAuthorized(req("Bearer undefined"), undefined)).toBe(false);
  });
});
