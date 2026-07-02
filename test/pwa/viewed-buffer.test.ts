import { describe, it, expect } from "vitest";
import { ViewedBuffer } from "../../src/pwa/viewed-buffer";

describe("ViewedBuffer", () => {
  it("collects new ids and drains them once", () => {
    const b = new ViewedBuffer();
    expect(b.add(1)).toBe(true);
    expect(b.add(1)).toBe(false);     // dedup while pending
    expect(b.add(2)).toBe(true);
    expect(b.drain()).toEqual([1, 2]);
    expect(b.drain()).toEqual([]);     // empty after drain
    expect(b.add(1)).toBe(false);      // already reported, never re-queued
  });

  it("restore puts failed ids back for the next drain", () => {
    const b = new ViewedBuffer();
    b.add(1); b.add(2);
    const batch = b.drain();
    b.restore(batch);                  // POST failed
    expect(b.drain()).toEqual([1, 2]); // retried next time
  });
});
