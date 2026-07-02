import { describe, it, expect } from "vitest";
import { selectTier2, type SelectionEntry, type SelectionConfig } from "../../src/selection/select";

function e(id: number, feed: number, created: string): SelectionEntry {
  return { id, feed_id: feed, title: `t${id}`, url: null, created_at: created };
}
const CFG: SelectionConfig = { coreTags: ["Must Read"], tailBudget: 3, perFeedCap: 3 };
const allTier2 = new Map<number, 1 | 2>([[10, 2], [11, 2], [12, 2], [13, 2]]);

describe("selectTier2", () => {
  it("is breadth-first: one item per feed before a second from any feed", () => {
    const entries = [
      e(1, 10, "2026-07-01T09:00:00Z"), e(2, 10, "2026-07-01T08:00:00Z"), e(3, 10, "2026-07-01T07:00:00Z"),
      e(4, 11, "2026-07-01T06:00:00Z"),
      e(5, 12, "2026-07-01T05:00:00Z"),
    ];
    const out = selectTier2(entries, allTier2, new Map(), CFG);
    expect(out.map((x) => x.feed_id)).toEqual([10, 11, 12]);
  });

  it("prioritises feeds with the oldest last_surfaced (anti-starvation)", () => {
    const entries = [e(1, 10, "2026-07-01T09:00:00Z"), e(2, 11, "2026-07-01T08:00:00Z"), e(3, 12, "2026-07-01T07:00:00Z")];
    const lastSurfaced = new Map<number, string>([
      [10, "2026-07-01T00:00:00Z"], // surfaced most recently -> lowest priority
      [11, "2026-06-01T00:00:00Z"], // stale -> higher priority
      // feed 12 never surfaced -> highest priority
    ]);
    const cfg: SelectionConfig = { coreTags: ["Must Read"], tailBudget: 2, perFeedCap: 3 };
    const out = selectTier2(entries, allTier2, lastSurfaced, cfg);
    expect(out.map((x) => x.feed_id)).toEqual([12, 11]);
  });

  it("caps items per feed", () => {
    const entries = [
      e(1, 10, "2026-07-01T09:00:00Z"), e(2, 10, "2026-07-01T08:00:00Z"),
      e(3, 10, "2026-07-01T07:00:00Z"), e(4, 10, "2026-07-01T06:00:00Z"),
    ];
    const cfg: SelectionConfig = { coreTags: ["Must Read"], tailBudget: 10, perFeedCap: 2 };
    const out = selectTier2(entries, allTier2, new Map(), cfg);
    expect(out.map((x) => x.id)).toEqual([1, 2]);
  });
});
