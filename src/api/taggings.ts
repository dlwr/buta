import { getFeed } from "../db/feeds";
import { listTaggings, findTagging, insertTagging, deleteTagging, renameTag, deleteTag } from "../db/taggings";
import { route, json, readJson } from "./router";
import { serializeTagging } from "./serialize";

export const taggingRoutes = [
  route("GET", /^\/v2\/taggings\.json$/, async ({ env }) => json((await listTaggings(env.DB)).map(serializeTagging))),

  route("POST", /^\/v2\/taggings\.json$/, async ({ request, env, url }) => {
    const body = await readJson<{ feed_id?: unknown; name?: unknown }>(request);
    const feedId = Number(body?.feed_id);
    if (!Number.isInteger(feedId) || typeof body?.name !== "string" || body.name === "") {
      return new Response("Bad Request", { status: 400 });
    }
    if (!(await getFeed(env.DB, feedId))) return new Response("Not Found", { status: 404 });
    const existing = await findTagging(env.DB, feedId, body.name);
    if (existing) {
      return new Response(null, { status: 302, headers: { Location: `${url.origin}/v2/taggings/${existing.id}.json` } });
    }
    return json(serializeTagging(await insertTagging(env.DB, feedId, body.name)), { status: 201 });
  }),

  route("GET", /^\/v2\/taggings\/(?<id>\d+)\.json$/, async ({ env, params }) => {
    const t = (await listTaggings(env.DB)).find((r) => r.id === Number(params.id));
    return t ? json(serializeTagging(t)) : new Response("Not Found", { status: 404 });
  }),

  route("DELETE", /^\/v2\/taggings\/(?<id>\d+)\.json$/, async ({ env, params }) => {
    const ok = await deleteTagging(env.DB, Number(params.id));
    return new Response(null, { status: ok ? 204 : 404 });
  }),

  route("POST", /^\/v2\/tags\.json$/, async ({ request, env }) => {
    const body = await readJson<{ old_name?: unknown; new_name?: unknown }>(request);
    if (typeof body?.old_name !== "string" || typeof body?.new_name !== "string") return new Response("Bad Request", { status: 400 });
    await renameTag(env.DB, body.old_name, body.new_name);
    return json((await listTaggings(env.DB)).map(serializeTagging));
  }),

  route("DELETE", /^\/v2\/tags\.json$/, async ({ request, env }) => {
    const body = await readJson<{ name?: unknown }>(request);
    if (typeof body?.name !== "string") return new Response("Bad Request", { status: 400 });
    await deleteTag(env.DB, body.name);
    return json((await listTaggings(env.DB)).map(serializeTagging));
  }),
];
