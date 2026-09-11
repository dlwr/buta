import { listFeeds, getFeed, renameFeed, deleteFeed } from "../db/feeds";
import { subscribeToUrl } from "../feeds/subscribe";
import { route, json, readJson } from "./router";
import { serializeSubscription } from "./serialize";

export const subscriptionRoutes = [
  route("GET", /^\/v2\/subscriptions\.json$/, async ({ env }) =>
    json((await listFeeds(env.DB)).map(serializeSubscription))),

  route("POST", /^\/v2\/subscriptions\.json$/, async ({ request, env, url }) => {
    const body = await readJson<{ feed_url?: unknown }>(request);
    if (typeof body?.feed_url !== "string" || body.feed_url === "") return new Response("Bad Request", { status: 400 });
    const result = await subscribeToUrl(env.DB, env.SYNC_KV, body.feed_url);
    switch (result.kind) {
      case "none": return new Response("Not Found", { status: 404 });
      case "error": return new Response(result.message, { status: 502 });
      case "existing": return new Response(null, { status: 302, headers: { Location: `${url.origin}/v2/subscriptions/${result.feed.id}.json` } });
      case "created": return json(serializeSubscription(result.feed), { status: 201 });
    }
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
