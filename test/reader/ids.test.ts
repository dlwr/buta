import { describe, it, expect } from "vitest";
import { toLongItemId, parseItemId } from "../../src/reader/ids";

describe("toLongItemId", () => {
  it("encodes the id as 16-digit zero-padded hex", () => {
    expect(toLongItemId(255)).toBe("tag:google.com,2005:reader/item/00000000000000ff");
  });
});

describe("parseItemId", () => {
  it("parses the long hex form", () => {
    expect(parseItemId("tag:google.com,2005:reader/item/00000000000000ff")).toBe(255);
  });
  it("parses a bare decimal", () => {
    expect(parseItemId("255")).toBe(255);
  });
  it("round-trips", () => {
    expect(parseItemId(toLongItemId(29534))).toBe(29534);
  });
  it("returns null for garbage", () => {
    expect(parseItemId("tag:google.com,2005:reader/item/zz")).toBeNull();
  });
});
