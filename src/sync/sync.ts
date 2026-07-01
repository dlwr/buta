import type { FeedbinClient } from "../feedbin/client";
import {
  upsertTaggings, upsertEntries, setUnreadFlags, setStarredFlags, getTrackedEntryIds,
} from "../db/queries";

export interface SyncDeps {
  db: D1Database;
  kv: KVNamespace;
  client: Pick<
    FeedbinClient,
    "getTaggings" | "getUnreadEntryIds" | "getStarredEntryIds" | "getEntriesByIds"
  >;
  now: () => string;
}

export interface SyncResult {
  hydrated: number;
  unread: number;
  starred: number;
}

export async function syncAll(deps: SyncDeps): Promise<SyncResult> {
  const { db, kv, client, now } = deps;
  const syncedAt = now();

  const taggings = await client.getTaggings();
  await upsertTaggings(db, taggings);

  const [unreadIds, starredIds] = await Promise.all([
    client.getUnreadEntryIds(),
    client.getStarredEntryIds(),
  ]);

  const wanted = new Set<number>([...unreadIds, ...starredIds]);
  const tracked = await getTrackedEntryIds(db);
  const missing = [...wanted].filter((id) => !tracked.has(id));

  const hydratedEntries = missing.length > 0
    ? await client.getEntriesByIds(missing)
    : [];
  await upsertEntries(db, hydratedEntries, syncedAt);

  await setUnreadFlags(db, unreadIds);
  await setStarredFlags(db, starredIds);

  await kv.put("last_sync", syncedAt);

  return { hydrated: hydratedEntries.length, unread: unreadIds.length, starred: starredIds.length };
}
