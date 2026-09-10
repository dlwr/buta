import type { EntryRow } from "../db/entries";
import type { FeedRow } from "../db/feeds";
import type { TaggingRow } from "../db/taggings";

export function serializeEntry(row: EntryRow) {
  return {
    id: row.id, feed_id: row.feed_id, title: row.title, author: row.author, summary: row.summary,
    content: row.content, url: row.url, extracted_content_url: null, extracted_articles: [],
    published: row.published, created_at: row.created_at, original: null, images: null, enclosure: null,
    twitter_id: null, twitter_thread_ids: [],
  };
}

export function serializeSubscription(row: FeedRow) {
  return { id: row.id, created_at: row.created_at, feed_id: row.id, title: row.title, feed_url: row.feed_url, site_url: row.site_url ?? "" };
}

export function serializeTagging(row: TaggingRow) {
  return { id: row.id, feed_id: row.feed_id, name: row.name };
}

// Capy Reader splits this header on ", " and "; " and reads ?page= from each URL,
// so every URL must carry a page parameter and contain no commas.
export function linksHeader(url: URL, page: number, perPage: number, total: number): string | null {
  const last = Math.max(1, Math.ceil(total / perPage));
  if (last === 1) return null;
  const withPage = (p: number) => {
    const u = new URL(url.href);
    u.searchParams.set("page", String(p));
    return `<${u.href}>; rel=`;
  };
  const parts: string[] = [];
  if (page < last) {
    parts.push(`${withPage(page + 1)}"next"`, `${withPage(last)}"last"`);
  } else {
    parts.push(`${withPage(1)}"first"`);
  }
  return parts.join(", ");
}
