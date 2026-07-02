import { FeedbinClient } from "./feedbin/client";
import {
  initSchema, getUnreadForSelection, getAllTaggings, getFeedLastSurfaced,
  markEntriesReadLocal, getFeedIdsForEntries, touchFeedLastSurfaced,
  setEntriesStarredLocal, getEntryById,
} from "./db/queries";
import { sanitizeHtml } from "./sanitize";
import { syncAll } from "./sync/sync";
import { buildSelection, buildFeedTierMap, DEFAULT_SELECTION_CONFIG } from "./selection/select";

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

    if (request.method === "GET" && url.pathname === "/feed") {
      if (!isAuthorized(request, env.ADMIN_TOKEN)) {
        return new Response("Unauthorized", { status: 401 });
      }
      const [entries, taggings, lastSurfaced] = await Promise.all([
        getUnreadForSelection(env.DB),
        getAllTaggings(env.DB),
        getFeedLastSurfaced(env.DB),
      ]);
      const selection = buildSelection(entries, taggings, lastSurfaced, DEFAULT_SELECTION_CONFIG);
      return Response.json(selection);
    }

    const entryMatch = url.pathname.match(/^\/entry\/(\d+)$/);
    if (request.method === "GET" && entryMatch) {
      if (!isAuthorized(request, env.ADMIN_TOKEN)) {
        return new Response("Unauthorized", { status: 401 });
      }
      const entry = await getEntryById(env.DB, Number(entryMatch[1]));
      if (!entry) return new Response("Not Found", { status: 404 });
      const content = entry.content ? await sanitizeHtml(entry.content) : null;
      return Response.json({ ...entry, content });
    }

    if (request.method === "POST" && url.pathname === "/admin/sync") {
      if (!isAuthorized(request, env.ADMIN_TOKEN)) {
        return new Response("Unauthorized", { status: 401 });
      }
      const result = await runSync(env);
      return Response.json(result);
    }

    if (request.method === "POST" && url.pathname === "/viewed") {
      if (!isAuthorized(request, env.ADMIN_TOKEN)) {
        return new Response("Unauthorized", { status: 401 });
      }
      const body = (await request.json().catch(() => null)) as { entryIds?: unknown } | null;
      const entryIds = body?.entryIds;
      if (!Array.isArray(entryIds) || entryIds.some((x) => typeof x !== "number")) {
        return new Response("Bad Request", { status: 400 });
      }
      if (entryIds.length === 0) {
        return Response.json({ read: 0, feedsTouched: 0 });
      }

      let confirmed: number[];
      try {
        confirmed = await makeFeedbinClient(env).markEntriesRead(entryIds as number[]);
      } catch {
        return new Response("Feedbin write failed", { status: 502 });
      }

      await markEntriesReadLocal(env.DB, confirmed);
      const feeds = await getFeedIdsForEntries(env.DB, confirmed);
      await touchFeedLastSurfaced(env.DB, [...feeds], new Date().toISOString());
      return Response.json({ read: confirmed.length, feedsTouched: feeds.size });
    }

    if (request.method === "POST" && url.pathname === "/star") {
      if (!isAuthorized(request, env.ADMIN_TOKEN)) {
        return new Response("Unauthorized", { status: 401 });
      }
      const body = (await request.json().catch(() => null)) as
        { entryIds?: unknown; starred?: unknown } | null;
      const entryIds = body?.entryIds;
      const starred = body?.starred;
      if (!Array.isArray(entryIds) || entryIds.some((x) => typeof x !== "number")
        || typeof starred !== "boolean") {
        return new Response("Bad Request", { status: 400 });
      }
      if (entryIds.length === 0) return Response.json({ updated: 0 });

      let confirmed: number[];
      try {
        const client = makeFeedbinClient(env);
        confirmed = starred
          ? await client.starEntries(entryIds as number[])
          : await client.unstarEntries(entryIds as number[]);
      } catch {
        return new Response("Feedbin write failed", { status: 502 });
      }

      await setEntriesStarredLocal(env.DB, confirmed, starred);
      return Response.json({ updated: confirmed.length });
    }

    if (request.method === "POST" && url.pathname === "/cleanup") {
      if (!isAuthorized(request, env.ADMIN_TOKEN)) {
        return new Response("Unauthorized", { status: 401 });
      }
      const body = (await request.json().catch(() => null)) as
        { olderThanDays?: unknown } | null;
      const days = body?.olderThanDays;
      if (typeof days !== "number" || !Number.isFinite(days) || days <= 0) {
        return new Response("Bad Request", { status: 400 });
      }
      const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();

      const [entries, taggings] = await Promise.all([
        getUnreadForSelection(env.DB),
        getAllTaggings(env.DB),
      ]);
      const tierMap = buildFeedTierMap(taggings, DEFAULT_SELECTION_CONFIG.coreTags);
      const targets = entries
        .filter((e) => (tierMap.get(e.feed_id) ?? 2) === 2)
        .filter((e) => (e.created_at ?? "") < cutoff)
        .map((e) => e.id);
      if (targets.length === 0) return Response.json({ read: 0 });

      let confirmed: number[];
      try {
        confirmed = await makeFeedbinClient(env).markEntriesRead(targets);
      } catch {
        return new Response("Feedbin write failed", { status: 502 });
      }
      await markEntriesReadLocal(env.DB, confirmed);
      return Response.json({ read: confirmed.length });
    }

    return new Response("Not Found", { status: 404 });
  },

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const result = await runSync(env);
    console.log("sync complete", result);
  },
} satisfies ExportedHandler<Env>;

// Constant-time string compare to avoid leaking the token via response timing.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isAuthorized(request: Request, token: string | undefined): boolean {
  // Fail closed: with no secret configured, deny all (never allow "Bearer undefined").
  if (!token) return false;
  const header = request.headers.get("Authorization");
  if (!header) return false;
  return timingSafeEqual(header, `Bearer ${token}`);
}

function makeFeedbinClient(env: Env): FeedbinClient {
  return new FeedbinClient({
    credentials: { email: env.FEEDBIN_EMAIL, password: env.FEEDBIN_PASSWORD },
  });
}

async function runSync(env: Env) {
  await initSchema(env.DB);
  const client = makeFeedbinClient(env);
  return syncAll({
    db: env.DB,
    kv: env.SYNC_KV,
    client,
    now: () => new Date().toISOString(),
  });
}
