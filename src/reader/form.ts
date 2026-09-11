import { isValidWriteToken } from "./auth";
import type { Handler, RouteContext } from "../api/router";

export const STATE_READ = "user/-/state/com.google/read";
export const STATE_STARRED = "user/-/state/com.google/starred";
export const STREAM_READING_LIST = "user/-/state/com.google/reading-list";
const LABEL_PREFIX = "user/-/label/";

export function labelName(stream: string | null): string | null {
  return stream?.startsWith(LABEL_PREFIX) ? stream.slice(LABEL_PREFIX.length) : null;
}

export function labelId(name: string): string {
  return LABEL_PREFIX + name;
}

export function feedIdFromStream(stream: string | null): number | null {
  const m = stream?.match(/^feed\/(\d+)$/);
  return m ? Number(m[1]) : null;
}

export function ok(): Response {
  return new Response("OK", { headers: { "Content-Type": "text/plain" } });
}

// Google Reader writes carry the short-lived token as form field T; the client
// refetches /token and retries once on 401, so a stale token is not fatal.
export function writeRoute(handler: (ctx: RouteContext & { form: URLSearchParams }) => Promise<Response>): Handler {
  return async (ctx) => {
    const form = new URLSearchParams(await ctx.request.text());
    if (!(await isValidWriteToken(form.get("T"), ctx.env.API_EMAIL, ctx.env.API_PASSWORD))) {
      return new Response("Unauthorized", { status: 401 });
    }
    return handler({ ...ctx, form });
  };
}

