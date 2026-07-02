import { describe, it, expect } from "vitest";
import { buildFeedTierMap } from "../../src/selection/select";

describe("buildFeedTierMap", () => {
  it("marks a feed Tier 1 when any of its tags is a core tag", () => {
    const m = buildFeedTierMap([
      { feed_id: 1, name: "Blog" },
      { feed_id: 1, name: "Must Read" }, // feed 1 is in both -> Tier 1 wins
      { feed_id: 2, name: "Blog" },
    ], ["Must Read"]);
    expect(m.get(1)).toBe(1);
    expect(m.get(2)).toBe(2);
  });

  it("omits feeds that have no taggings", () => {
    const m = buildFeedTierMap([{ feed_id: 1, name: "Blog" }], ["Must Read"]);
    expect(m.has(99)).toBe(false);
  });
});
