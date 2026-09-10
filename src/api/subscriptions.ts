import { listFeeds, getFeed, findFeedByUrl, insertFeed, renameFeed, deleteFeed } from "../db/feeds";
import { resolveFeed } from "../feeds/discover";
import { parseFeedDocument } from "../feeds/parse";
import { crawlFeed } from "../crawl/crawl";
import { route, json, readJson } from "./router";
import { serializeSubscription } from "./serialize";

export const subscriptionRoutes = [
  route("GET", /^\/v2\/subscriptions\.json$/, async ({ env }) =>
    json((await listFeeds(env.DB)).map(serializeSubscription))),

  route("POST", /^\/v2\/subscriptions\.json$/, async ({ request, env, url }) => {
    const body = await readJson<{ feed_url?: unknown }>(request);
    if (typeof body?.feed_url !== "string" || body.feed_url === "") return new Response("Bad Request", { status: 400 });
    const fetchFn = globalThis.fetch.bind(globalThis);
    const existingByInput = await findFeedByUrl(env.DB, body.feed_url);
    if (existingByInput) return redirectTo(url, existingByInput.id);

    const resolved = await resolveFeed(body.feed_url, fetchFn);
    if (resolved.kind === "none") return new Response("Not Found", { status: 404 });
    if (resolved.kind === "error") return new Response(resolved.message, { status: 502 });
    const existing = await findFeedByUrl(env.DB, resolved.feedUrl);
    if (existing) return redirectTo(url, existing.id);

    const parsed = parseFeedDocument(resolved.text);
    const now = () => new Date().toISOString();
    const feed = await insertFeed(env.DB, {
      feedUrl: resolved.feedUrl, siteUrl: parsed.siteUrl, title: parsed.title ?? resolved.feedUrl, createdAt: now(),
    });
    await crawlFeed({ db: env.DB, kv: env.SYNC_KV, fetchFn, now }, feed);
    return json(serializeSubscription(feed), { status: 201 });
  }),

  route("GET", /^\/v2\/subscriptions\/(?<id>\d+)\.json$/, async ({ env, params }) => {
    const feed = await getFeed(env.DB, Number(params.id));
    return feed ? json(serializeSubscription(feed)) : new Response("Not Found", { status: 404 });
  }),

  route("PATCH", /^\/v2\/subscriptions\/(?<id>\d+)\.json$/, async ({ request, env, params }) => {
    const body = await readJson<{ title?: unknown }>(request);
    if (typeof body?.title !== "string") return new Response("Bad Request", { status: 400 });
    const id = Number(params.id);
    if (!(await renameFeed(env.DB, id, body.title))) return new Response("Not Found", { status: 404 });
    const feed = await getFeed(env.DB, id);
    return json(serializeSubscription(feed!));
  }),

  route("DELETE", /^\/v2\/subscriptions\/(?<id>\d+)\.json$/, async ({ env, params }) => {
    const ok = await deleteFeed(env.DB, Number(params.id));
    return new Response(null, { status: ok ? 204 : 404 });
  }),
];

function redirectTo(url: URL, id: number): Response {
  return new Response(null, { status: 302, headers: { Location: `${url.origin}/v2/subscriptions/${id}.json` } });
}
