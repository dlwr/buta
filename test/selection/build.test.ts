import { describe, it, expect } from "vitest";
import { buildSelection, DEFAULT_SELECTION_CONFIG, type SelectionEntry } from "../../src/selection/select";

function e(id: number, feed: number, created: string): SelectionEntry {
  return { id, feed_id: feed, title: `t${id}`, url: null, created_at: created };
}

describe("buildSelection", () => {
  it("splits entries into tier1 (core) and tier2 (sampled tail)", () => {
    const entries = [
      e(1, 1, "2026-07-01T09:00:00Z"),  // feed 1 = Must Read -> tier1
      e(2, 2, "2026-07-01T08:00:00Z"),  // feed 2 = Blog -> tier2
      e(3, 3, "2026-07-01T07:00:00Z"),  // feed 3 = untagged -> tier2
    ];
    const taggings = [
      { feed_id: 1, name: "Must Read" },
      { feed_id: 2, name: "Blog" },
    ];
    const sel = buildSelection(entries, taggings, new Map(), DEFAULT_SELECTION_CONFIG);
    expect(sel.tier1.map((x) => x.id)).toEqual([1]);
    expect(sel.tier2.map((x) => x.id).sort()).toEqual([2, 3]);
  });
});
