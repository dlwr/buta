import { listTaggings, renameTag, deleteTag } from "../db/taggings";
import { route, json, type Route } from "../api/router";
import { STATE_STARRED, labelId, labelName, ok, writeRoute } from "./form";

export const readerTagRoutes: Route[] = [
  route("GET", /^\/reader\/api\/0\/tag\/list$/, async ({ env }) => {
    const names = [...new Set((await listTaggings(env.DB)).map((t) => t.name))];
    return json({ tags: [
      { id: STATE_STARRED, type: "tag" },
      ...names.map((n) => ({ id: labelId(n), type: "folder" })),
    ] });
  }),

  route("POST", /^\/reader\/api\/0\/rename-tag$/, writeRoute(async ({ env, form }) => {
    const from = labelName(form.get("s"));
    const to = labelName(form.get("dest"));
    if (!from || !to) return new Response("Bad Request", { status: 400 });
    await renameTag(env.DB, from, to);
    return ok();
  })),

  route("POST", /^\/reader\/api\/0\/disable-tag$/, writeRoute(async ({ env, form }) => {
    const name = labelName(form.get("s"));
    if (!name) return new Response("Bad Request", { status: 400 });
    await deleteTag(env.DB, name);
    return ok();
  })),
];
