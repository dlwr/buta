import type { Env } from "./env";
import { crawlAllFeeds, type CrawlDeps } from "./crawl/crawl";
import { isBasicAuthorized, unauthorized } from "./api/auth";
import { dispatch, type Route } from "./api/router";
import { miscRoutes } from "./api/misc";
import { entryRoutes } from "./api/entries";
import { markRoutes } from "./api/marks";
import { subscriptionRoutes } from "./api/subscriptions";
import { taggingRoutes } from "./api/taggings";
import { isAdminAuthorized } from "./admin/auth";
import { importOpml } from "./admin/import-opml";
import { migrateLegacyState } from "./admin/migrate-legacy";
import { isReaderAuthorized } from "./reader/auth";
import { handleClientLogin, tokenRoutes } from "./reader/login";
import { streamRoutes } from "./reader/streams";
import { readerSubscriptionRoutes } from "./reader/subscriptions";
import { readerTagRoutes } from "./reader/tags";

const apiRoutes: Route[] = [...miscRoutes, ...entryRoutes, ...markRoutes, ...subscriptionRoutes, ...taggingRoutes];
const readerRoutes: Route[] = [...tokenRoutes, ...streamRoutes, ...readerSubscriptionRoutes, ...readerTagRoutes];

function crawlDeps(env: Env): CrawlDeps {
  return { db: env.DB, kv: env.SYNC_KV, fetchFn: globalThis.fetch.bind(globalThis), now: () => new Date().toISOString() };
}

async function handleAdmin(request: Request, env: Env, url: URL): Promise<Response> {
  if (!isAdminAuthorized(request, env.ADMIN_TOKEN)) return new Response("Unauthorized", { status: 401 });
  if (request.method !== "POST") return new Response("Not Found", { status: 404 });
  switch (url.pathname) {
    case "/admin/opml":
      return Response.json(await importOpml(env.DB, await request.text(), new Date().toISOString()));
    case "/admin/crawl":
      return Response.json((await crawlAllFeeds(crawlDeps(env))) ?? { locked: true });
    case "/admin/migrate-legacy":
      return Response.json(await migrateLegacyState(env.DB));
    default:
      return new Response("Not Found", { status: 404 });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true });

    if (url.pathname.startsWith("/v2/")) {
      if (!isBasicAuthorized(request, env.API_EMAIL, env.API_PASSWORD)) return unauthorized();
      return (await dispatch(apiRoutes, request, env)) ?? new Response("Not Found", { status: 404 });
    }
    if (request.method === "POST" && url.pathname === "/accounts/ClientLogin") return handleClientLogin(request, env);
    if (url.pathname.startsWith("/reader/api/0/")) {
      if (!(await isReaderAuthorized(request, env.API_EMAIL, env.API_PASSWORD))) return new Response("Unauthorized", { status: 401 });
      return (await dispatch(readerRoutes, request, env)) ?? new Response("Not Found", { status: 404 });
    }
    if (url.pathname.startsWith("/admin/")) return handleAdmin(request, env, url);
    return new Response("Not Found", { status: 404 });
  },
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const summary = await crawlAllFeeds(crawlDeps(env));
    console.log("crawl", summary ?? "skipped: locked");
  },
} satisfies ExportedHandler<Env>;
