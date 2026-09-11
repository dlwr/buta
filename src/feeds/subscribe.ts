import { findFeedByUrl, insertFeed, type FeedRow } from "../db/feeds";
import { crawlFeed } from "../crawl/crawl";
import { resolveFeed } from "./discover";
import { parseFeedDocument } from "./parse";

export type SubscribeResult =
  | { kind: "created"; feed: FeedRow }
  | { kind: "existing"; feed: FeedRow }
  | { kind: "none" }
  | { kind: "error"; message: string };

export async function subscribeToUrl(db: D1Database, kv: KVNamespace, url: string): Promise<SubscribeResult> {
  const fetchFn = globalThis.fetch.bind(globalThis);
  const byInput = await findFeedByUrl(db, url);
  if (byInput) return { kind: "existing", feed: byInput };

  const resolved = await resolveFeed(url, fetchFn);
  if (resolved.kind === "none") return { kind: "none" };
  if (resolved.kind === "error") return { kind: "error", message: resolved.message };
  const existing = await findFeedByUrl(db, resolved.feedUrl);
  if (existing) return { kind: "existing", feed: existing };

  const parsed = parseFeedDocument(resolved.text);
  const now = () => new Date().toISOString();
  const feed = await insertFeed(db, {
    feedUrl: resolved.feedUrl, siteUrl: parsed.siteUrl, title: parsed.title ?? resolved.feedUrl, createdAt: now(),
  });
  await crawlFeed({ db, kv, fetchFn, now }, feed);
  return { kind: "created", feed };
}
