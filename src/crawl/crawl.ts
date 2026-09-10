import { listFeeds, recordFetchSuccess, recordFetchFailure, type FeedRow } from "../db/feeds";
import { insertNewEntries, type NewEntry } from "../db/entries";
import { addMarks } from "../db/marks";
import { fetchFeed } from "../feeds/fetch";
import { parseFeedDocument, type ParsedFeed } from "../feeds/parse";
import { mapWithConcurrency } from "./concurrency";

export interface CrawlDeps {
  db: D1Database; kv: KVNamespace; fetchFn: typeof fetch; now: () => string;
  feedDeadlineMs?: number;
}
export interface CrawlSummary { fetched: number; notModified: number; skipped: number; failed: number; newEntries: number }
export interface FeedCrawlResult { outcome: "fetched" | "not-modified" | "failed"; newEntries: number }

export const CRAWL_LOCK_KEY = "crawl_lock";
const LOCK_TTL_SECONDS = 600;
const CONCURRENCY = 20;
const BASE_INTERVAL_MS = 15 * 60_000;
const MAX_BACKOFF_STEPS = 8;
const FEED_DEADLINE_MS = 45_000;

export function isInBackoff(feed: FeedRow, nowMs: number): boolean {
  if (feed.error_count === 0 || feed.last_fetched_at === null) return false;
  const steps = Math.min(feed.error_count, MAX_BACKOFF_STEPS);
  return Date.parse(feed.last_fetched_at) + steps * BASE_INTERVAL_MS > nowMs;
}

export async function crawlAllFeeds(deps: CrawlDeps): Promise<CrawlSummary | null> {
  if (await deps.kv.get(CRAWL_LOCK_KEY) !== null) return null;
  await deps.kv.put(CRAWL_LOCK_KEY, deps.now(), { expirationTtl: LOCK_TTL_SECONDS });
  try {
    const nowMs = Date.parse(deps.now());
    const summary: CrawlSummary = { fetched: 0, notModified: 0, skipped: 0, failed: 0, newEntries: 0 };
    const feeds = await listFeeds(deps.db);
    const due = feeds.filter((f) => {
      if (isInBackoff(f, nowMs)) { summary.skipped++; return false; }
      return true;
    });
    const results = await mapWithConcurrency(due, CONCURRENCY, (feed) => crawlFeed(deps, feed));
    for (const r of results) {
      if (r.outcome === "fetched") summary.fetched++;
      else if (r.outcome === "not-modified") summary.notModified++;
      else summary.failed++;
      summary.newEntries += r.newEntries;
    }
    return summary;
  } finally {
    await deps.kv.delete(CRAWL_LOCK_KEY);
  }
}

export async function crawlFeed(deps: CrawlDeps, feed: FeedRow): Promise<FeedCrawlResult> {
  const fetchedAt = deps.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), deps.feedDeadlineMs ?? FEED_DEADLINE_MS);
  });
  const outcome = await Promise.race([crawlFeedUnbounded(deps, feed, fetchedAt), deadline]);
  clearTimeout(timer);
  if (outcome !== "timeout") return outcome;
  await recordFetchFailure(deps.db, feed.id, { message: "timeout", fetchedAt });
  return { outcome: "failed", newEntries: 0 };
}

async function crawlFeedUnbounded(deps: CrawlDeps, feed: FeedRow, fetchedAt: string): Promise<FeedCrawlResult> {
  const res = await fetchFeed(
    { feedUrl: feed.feed_url, etag: feed.etag, lastModified: feed.last_modified }, deps.fetchFn,
  );
  if (res.status === "not-modified") {
    await recordFetchSuccess(deps.db, feed.id, { etag: feed.etag, lastModified: feed.last_modified, fetchedAt });
    return { outcome: "not-modified", newEntries: 0 };
  }
  if (res.status === "error") {
    await recordFetchFailure(deps.db, feed.id, { message: res.message, fetchedAt });
    return { outcome: "failed", newEntries: 0 };
  }
  let parsed: ParsedFeed;
  try {
    parsed = parseFeedDocument(res.text);
  } catch (e) {
    await recordFetchFailure(deps.db, feed.id, { message: `parse: ${e instanceof Error ? e.message : String(e)}`, fetchedAt });
    return { outcome: "failed", newEntries: 0 };
  }
  const entries: NewEntry[] = parsed.items.map((item) => ({
    feedId: feed.id, dedupKey: item.dedupKey, title: item.title, url: item.url, author: item.author,
    summary: item.summary, content: item.content, published: item.published ?? fetchedAt, createdAt: fetchedAt,
  }));
  const ids = await insertNewEntries(deps.db, entries);
  await addMarks(deps.db, "unread_entries", ids);
  await recordFetchSuccess(deps.db, feed.id, { etag: res.etag, lastModified: res.lastModified, fetchedAt });
  return { outcome: "fetched", newEntries: ids.length };
}
