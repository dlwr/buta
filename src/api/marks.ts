import { listMarked, addMarks, removeMarks, type MarkTable } from "../db/marks";
import { route, json, readJson, type Handler } from "./router";

const MAX_IDS = 1000;

function idsFrom(body: unknown, key: MarkTable): number[] | null {
  const list = (body as Record<string, unknown> | null)?.[key];
  if (!Array.isArray(list) || list.length > MAX_IDS) return null;
  if (!list.every((x) => Number.isInteger(x))) return null;
  return list as number[];
}

function markHandler(table: MarkTable, action: "add" | "remove"): Handler {
  return async ({ request, env }) => {
    const ids = idsFrom(await readJson(request), table);
    if (ids === null) return new Response("Bad Request", { status: 400 });
    if (action === "add") await addMarks(env.DB, table, ids);
    else await removeMarks(env.DB, table, ids);
    return json(ids);
  };
}

function routesFor(table: MarkTable) {
  const base = new RegExp(`^/v2/${table}\\.json$`);
  const del = new RegExp(`^/v2/${table}/delete\\.json$`);
  return [
    route("GET", base, async ({ env }) => json(await listMarked(env.DB, table))),
    route("POST", base, markHandler(table, "add")),
    route("DELETE", base, markHandler(table, "remove")),
    route("POST", del, markHandler(table, "remove")),
  ];
}

export const markRoutes = [...routesFor("unread_entries"), ...routesFor("starred_entries")];
