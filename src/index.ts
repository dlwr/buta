import { FeedbinClient } from "./feedbin/client";
import { initSchema } from "./db/queries";
import { syncAll } from "./sync/sync";

export interface Env {
  DB: D1Database;
  SYNC_KV: KVNamespace;
  FEEDBIN_EMAIL: string;
  FEEDBIN_PASSWORD: string;
  ADMIN_TOKEN: string;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true });
    }

    if (request.method === "POST" && url.pathname === "/admin/sync") {
      if (request.headers.get("Authorization") !== `Bearer ${env.ADMIN_TOKEN}`) {
        return new Response("Unauthorized", { status: 401 });
      }
      const result = await runSync(env);
      return Response.json(result);
    }

    return new Response("Not Found", { status: 404 });
  },

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const result = await runSync(env);
    console.log("sync complete", result);
  },
} satisfies ExportedHandler<Env>;

async function runSync(env: Env) {
  await initSchema(env.DB);
  const client = new FeedbinClient({
    credentials: { email: env.FEEDBIN_EMAIL, password: env.FEEDBIN_PASSWORD },
  });
  return syncAll({
    db: env.DB,
    kv: env.SYNC_KV,
    client,
    now: () => new Date().toISOString(),
  });
}
