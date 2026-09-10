import type { Env } from "./env";
import { crawlAllFeeds } from "./crawl/crawl";
import { isBasicAuthorized, unauthorized } from "./api/auth";
import { dispatch, type Route } from "./api/router";
import { miscRoutes } from "./api/misc";

const apiRoutes: Route[] = [...miscRoutes];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true });

    if (url.pathname.startsWith("/v2/")) {
      if (!isBasicAuthorized(request, env.API_EMAIL, env.API_PASSWORD)) return unauthorized();
      return (await dispatch(apiRoutes, request, env)) ?? new Response("Not Found", { status: 404 });
    }
    return new Response("Not Found", { status: 404 });
  },
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const summary = await crawlAllFeeds({
      db: env.DB, kv: env.SYNC_KV, fetchFn: globalThis.fetch.bind(globalThis), now: () => new Date().toISOString(),
    });
    console.log("crawl", summary ?? "skipped: locked");
  },
} satisfies ExportedHandler<Env>;
