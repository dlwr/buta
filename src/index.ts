import type { Env } from "./env";
import { crawlAllFeeds } from "./crawl/crawl";

export default {
  async fetch(_request: Request, _env: Env): Promise<Response> {
    return new Response("Not Found", { status: 404 });
  },
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const summary = await crawlAllFeeds({
      db: env.DB, kv: env.SYNC_KV, fetchFn: globalThis.fetch.bind(globalThis), now: () => new Date().toISOString(),
    });
    console.log("crawl", summary ?? "skipped: locked");
  },
} satisfies ExportedHandler<Env>;
