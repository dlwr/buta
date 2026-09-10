import { describe, it, expect } from "vitest";
import { mapWithConcurrency } from "../../src/crawl/concurrency";

describe("mapWithConcurrency", () => {
  it("preserves input order in results", async () => {
    const out = await mapWithConcurrency([3, 1, 2], 2, async (n) => { await new Promise((r) => setTimeout(r, n)); return n * 10; });
    expect(out).toEqual([30, 10, 20]);
  });

  it("never runs more than limit at once", async () => {
    let running = 0; let peak = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5], 2, async () => {
      running++; peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
    });
    expect(peak).toBe(2);
  });

  it("returns empty for empty input", async () => {
    expect(await mapWithConcurrency([], 3, async (x: number) => x)).toEqual([]);
  });
});
