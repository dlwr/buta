import { queryEntries, getEntry, type EntryQuery } from "../db/entries";
import { route, json, type RouteContext } from "./router";
import { serializeEntry, linksHeader } from "./serialize";

const MAX_PER_PAGE = 100;
const MAX_IDS = 90;

function parseQuery(url: URL, feedId?: number): EntryQuery {
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, Number(url.searchParams.get("per_page") ?? MAX_PER_PAGE) || MAX_PER_PAGE));
  const q: EntryQuery = { page, perPage };
  const since = url.searchParams.get("since");
  if (since) {
    const ms = Date.parse(since);
    if (!Number.isNaN(ms)) q.since = new Date(ms).toISOString();
  }
  const ids = url.searchParams.get("ids");
  if (ids) q.ids = ids.split(",").map(Number).filter(Number.isInteger).slice(0, MAX_IDS);
  if (url.searchParams.get("read") === "false") q.onlyUnread = true;
  if (url.searchParams.get("starred") === "true") q.onlyStarred = true;
  if (feedId !== undefined) q.feedId = feedId;
  return q;
}

async function listEntries({ env, url }: RouteContext, feedId?: number): Promise<Response> {
  const q = parseQuery(url, feedId);
  const { rows, total } = await queryEntries(env.DB, q);
  const headers: Record<string, string> = {};
  const links = linksHeader(url, q.page, q.perPage, total);
  if (links) headers.Links = links;
  return json(rows.map(serializeEntry), { headers });
}

export const entryRoutes = [
  route("GET", /^\/v2\/entries\.json$/, (ctx) => listEntries(ctx)),
  route("GET", /^\/v2\/feeds\/(?<id>\d+)\/entries\.json$/, (ctx) => listEntries(ctx, Number(ctx.params.id))),
  route("GET", /^\/v2\/entries\/(?<id>\d+)\.json$/, async ({ env, params }) => {
    const row = await getEntry(env.DB, Number(params.id));
    return row ? json(serializeEntry(row)) : new Response("Not Found", { status: 404 });
  }),
];
