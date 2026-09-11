import { listFeeds, getFeed, renameFeed, deleteFeed } from "../db/feeds";
import { listTaggings, findTagging, insertTagging, deleteTagging } from "../db/taggings";
import { subscribeToUrl } from "../feeds/subscribe";
import { route, json, type Route } from "../api/router";
import { feedIdFromStream, labelId, labelName, ok, writeRoute } from "./form";

export const readerSubscriptionRoutes: Route[] = [
  route("GET", /^\/reader\/api\/0\/subscription\/list$/, async ({ env }) => {
    const [feeds, taggings] = await Promise.all([listFeeds(env.DB), listTaggings(env.DB)]);
    return json({
      subscriptions: feeds.map((f) => ({
        id: `feed/${f.id}`,
        title: f.title,
        categories: taggings.filter((t) => t.feed_id === f.id).map((t) => ({ id: labelId(t.name), label: t.name })),
        url: f.feed_url,
        htmlUrl: f.site_url ?? "",
        iconUrl: "",
      })),
    });
  }),

  route("POST", /^\/reader\/api\/0\/subscription\/edit$/, writeRoute(async ({ env, form }) => {
    const feedId = feedIdFromStream(form.get("s"));
    if (feedId === null) return new Response("Bad Request", { status: 400 });
    if (!(await getFeed(env.DB, feedId))) return new Response("Not Found", { status: 404 });
    if (form.get("ac") === "unsubscribe") {
      await deleteFeed(env.DB, feedId);
      return ok();
    }
    const title = form.get("t");
    if (title) await renameFeed(env.DB, feedId, title);
    const remove = labelName(form.get("r"));
    if (remove) {
      const t = await findTagging(env.DB, feedId, remove);
      if (t) await deleteTagging(env.DB, t.id);
    }
    const add = labelName(form.get("a"));
    if (add && !(await findTagging(env.DB, feedId, add))) await insertTagging(env.DB, feedId, add);
    return ok();
  })),

  route("POST", /^\/reader\/api\/0\/subscription\/quickadd$/, writeRoute(async ({ env, form }) => {
    const url = form.get("quickadd");
    if (!url) return new Response("Bad Request", { status: 400 });
    const result = await subscribeToUrl(env.DB, env.SYNC_KV, url);
    if (result.kind === "none") return json({ numResults: 0, query: url, error: "No feed found" });
    if (result.kind === "error") return json({ numResults: 0, query: url, error: result.message });
    return json({ numResults: 1, query: url, streamId: `feed/${result.feed.id}`, streamName: result.feed.title });
  })),
];
