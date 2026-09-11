import { listEntryIds, getEntriesWithState, type EntryIdQuery, type EntryWithState } from "../db/entries";
import { listTaggings } from "../db/taggings";
import { addMarks, removeMarks } from "../db/marks";
import { route, json, type Route } from "../api/router";
import { toLongItemId, parseItemId } from "./ids";
import { STATE_READ, STATE_STARRED, STREAM_READING_LIST, feedIdFromStream, labelId, ok, writeRoute } from "./form";

const MAX_ITEMS = 1000;

function idsQuery(url: URL): EntryIdQuery | null {
  const s = url.searchParams.get("s");
  const q: EntryIdQuery = {
    limit: Math.min(MAX_ITEMS, Math.max(1, Number(url.searchParams.get("n") ?? 20) || 20)),
    offset: Math.max(0, Number(url.searchParams.get("c") ?? 0) || 0),
  };
  const feedId = feedIdFromStream(s);
  if (feedId !== null) q.feedId = feedId;
  else if (s === STATE_STARRED) q.onlyStarred = true;
  else if (s !== STREAM_READING_LIST) return null;
  if (url.searchParams.get("xt") === STATE_READ) q.onlyUnread = true;
  const ot = Number(url.searchParams.get("ot"));
  if (ot > 0) q.createdSince = new Date(ot * 1000).toISOString();
  return q;
}

function serializeItem(row: EntryWithState, labels: string[]) {
  const crawledMs = Date.parse(row.created_at);
  const published = Math.floor(Date.parse(row.published) / 1000);
  const categories = [STREAM_READING_LIST];
  if (!row.is_unread) categories.push(STATE_READ);
  if (row.is_starred) categories.push(STATE_STARRED);
  categories.push(...labels.map(labelId));
  return {
    id: toLongItemId(row.id),
    crawlTimeMsec: String(crawledMs),
    timestampUsec: String(crawledMs * 1000),
    published, updated: published,
    title: row.title ?? "", author: row.author,
    summary: { direction: "ltr", content: row.content ?? row.summary ?? "" },
    ...(row.content !== null ? { content: { direction: "ltr", content: row.content } } : {}),
    alternate: row.url ? [{ href: row.url, type: "text/html" }] : [],
    canonical: row.url ? [{ href: row.url }] : [],
    categories,
    origin: { streamId: `feed/${row.feed_id}`, title: row.feed_title, htmlUrl: row.feed_site_url ?? "" },
  };
}

function itemIds(form: URLSearchParams): number[] {
  return form.getAll("i").map(parseItemId).filter((id): id is number => id !== null);
}

export const streamRoutes: Route[] = [
  route("GET", /^\/reader\/api\/0\/stream\/items\/ids$/, async ({ env, url }) => {
    const q = idsQuery(url);
    if (!q) return new Response("Bad Request", { status: 400 });
    const { ids, hasMore } = await listEntryIds(env.DB, q);
    const body: { itemRefs: { id: string }[]; continuation?: string } = { itemRefs: ids.map((id) => ({ id: String(id) })) };
    if (hasMore) body.continuation = String(q.offset + q.limit);
    return json(body);
  }),

  route("POST", /^\/reader\/api\/0\/stream\/items\/contents$/, writeRoute(async ({ env, form }) => {
    const rows = await getEntriesWithState(env.DB, itemIds(form));
    const labelsByFeed = new Map<number, string[]>();
    for (const t of await listTaggings(env.DB)) labelsByFeed.set(t.feed_id, [...(labelsByFeed.get(t.feed_id) ?? []), t.name]);
    return json({
      id: STREAM_READING_LIST,
      updated: Math.floor(Date.now() / 1000),
      items: rows.map((r) => serializeItem(r, labelsByFeed.get(r.feed_id) ?? [])),
    });
  })),

  route("POST", /^\/reader\/api\/0\/edit-tag$/, writeRoute(async ({ env, form }) => {
    const ids = itemIds(form);
    for (const state of form.getAll("a")) {
      if (state === STATE_READ) await removeMarks(env.DB, "unread_entries", ids);
      if (state === STATE_STARRED) await addMarks(env.DB, "starred_entries", ids);
    }
    for (const state of form.getAll("r")) {
      if (state === STATE_READ) await addMarks(env.DB, "unread_entries", ids);
      if (state === STATE_STARRED) await removeMarks(env.DB, "starred_entries", ids);
    }
    return ok();
  })),
];
