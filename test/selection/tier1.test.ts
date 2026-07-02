import { describe, it, expect } from "vitest";
import { selectTier1, type SelectionEntry } from "../../src/selection/select";

function e(id: number, feed: number, created: string | null): SelectionEntry {
  return { id, feed_id: feed, title: `t${id}`, url: null, created_at: created };
}

describe("selectTier1", () => {
  it("returns all Tier 1 entries newest-first", () => {
    const tierMap = new Map<number, 1 | 2>([[1, 1], [2, 2]]);
    const entries = [
      e(1, 1, "2026-07-01T00:00:00Z"),
      e(2, 2, "2026-07-03T00:00:00Z"), // Tier 2 -> excluded
      e(3, 1, "2026-07-02T00:00:00Z"),
    ];
    const out = selectTier1(entries, tierMap);
    expect(out.map((x) => x.id)).toEqual([3, 1]);
  });
});
