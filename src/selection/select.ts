export interface SelectionEntry {
  id: number;
  feed_id: number;
  title: string | null;
  url: string | null;
  created_at: string | null;
}

export function buildFeedTierMap(
  taggings: { feed_id: number; name: string }[],
  coreTags: string[],
): Map<number, 1 | 2> {
  const core = new Set(coreTags);
  const map = new Map<number, 1 | 2>();
  for (const t of taggings) {
    const isCore = core.has(t.name);
    const current = map.get(t.feed_id);
    // Tier 1 wins if any tag is core; otherwise default to Tier 2.
    if (isCore) map.set(t.feed_id, 1);
    else if (current === undefined) map.set(t.feed_id, 2);
  }
  return map;
}
