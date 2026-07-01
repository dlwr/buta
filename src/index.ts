import { FeedbinClient } from "./feedbin/client";
import { initSchema } from "./db/queries";
import { syncAll } from "./sync/sync";

export interface Env {
  DB: D1Database;
  SYNC_KV: KVNamespace;
  FEEDBIN_EMAIL: string;
  FEEDBIN_PASSWORD: string;
}

export default {
  async fetch(request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true });
    }
    return new Response("Not Found", { status: 404 });
  },

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await initSchema(env.DB);
    const client = new FeedbinClient({
      credentials: { email: env.FEEDBIN_EMAIL, password: env.FEEDBIN_PASSWORD },
    });
    const result = await syncAll({
      db: env.DB,
      kv: env.SYNC_KV,
      client,
      now: () => new Date().toISOString(),
    });
    console.log("sync complete", result);
  },
} satisfies ExportedHandler<Env>;
