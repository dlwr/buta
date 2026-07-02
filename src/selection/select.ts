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

function cmpCreatedDesc(a: SelectionEntry, b: SelectionEntry): number {
  const av = a.created_at ?? "";
  const bv = b.created_at ?? "";
  return av < bv ? 1 : av > bv ? -1 : 0;
}

export function selectTier1(
  entries: SelectionEntry[], tierMap: Map<number, 1 | 2>,
): SelectionEntry[] {
  return entries
    .filter((e) => tierMap.get(e.feed_id) === 1)
    .sort(cmpCreatedDesc);
}

export interface SelectionConfig {
  coreTags: string[];
  tailBudget: number;
  perFeedCap: number;
}

export function selectTier2(
  entries: SelectionEntry[],
  tierMap: Map<number, 1 | 2>,
  lastSurfaced: Map<number, string>,
  cfg: SelectionConfig,
): SelectionEntry[] {
  // (1) group Tier 2 entries by feed; newest-first; cap per feed
  const byFeed = new Map<number, SelectionEntry[]>();
  for (const e of entries) {
    if ((tierMap.get(e.feed_id) ?? 2) !== 2) continue;
    const list = byFeed.get(e.feed_id);
    if (list) list.push(e);
    else byFeed.set(e.feed_id, [e]);
  }
  for (const [feed, list] of byFeed) {
    list.sort(cmpCreatedDesc);
    byFeed.set(feed, list.slice(0, cfg.perFeedCap));
  }

  // (2) order feeds: oldest last_surfaced first (never-surfaced first),
  //     tie-break by freshest item desc
  const feeds = [...byFeed.keys()].sort((a, b) => {
    const la = lastSurfaced.get(a);
    const lb = lastSurfaced.get(b);
    if (la !== lb) {
      if (la === undefined) return -1;
      if (lb === undefined) return 1;
      return la < lb ? -1 : 1;
    }
    return cmpCreatedDesc(byFeed.get(a)![0]!, byFeed.get(b)![0]!);
  });

  // (3) breadth-first round-robin until budget
  const out: SelectionEntry[] = [];
  let pass = 0;
  while (out.length < cfg.tailBudget && feeds.some((f) => byFeed.get(f)!.length > pass)) {
    for (const f of feeds) {
      const items = byFeed.get(f)!;
      if (pass < items.length) {
        out.push(items[pass]!);
        if (out.length >= cfg.tailBudget) break;
      }
    }
    pass++;
  }
  return out;
}

export interface Selection {
  tier1: SelectionEntry[];
  tier2: SelectionEntry[];
}

export const DEFAULT_SELECTION_CONFIG: SelectionConfig = {
  coreTags: ["Must Read"],
  tailBudget: 30,
  perFeedCap: 3,
};

export function buildSelection(
  entries: SelectionEntry[],
  taggings: { feed_id: number; name: string }[],
  lastSurfaced: Map<number, string>,
  cfg: SelectionConfig,
): Selection {
  const tierMap = buildFeedTierMap(taggings, cfg.coreTags);
  return {
    tier1: selectTier1(entries, tierMap),
    tier2: selectTier2(entries, tierMap, lastSurfaced, cfg),
  };
}
