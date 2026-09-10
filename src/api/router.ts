import type { Env } from "../env";

export interface RouteContext { request: Request; env: Env; url: URL; params: Record<string, string> }
export type Handler = (ctx: RouteContext) => Promise<Response>;
export interface Route { method: string; pattern: RegExp; handler: Handler }

export function route(method: string, pattern: RegExp, handler: Handler): Route {
  return { method, pattern, handler };
}

export async function dispatch(routes: Route[], request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  for (const r of routes) {
    if (r.method !== request.method) continue;
    const m = url.pathname.match(r.pattern);
    if (!m) continue;
    return r.handler({ request, env, url, params: m.groups ?? {} });
  }
  return null;
}

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export function json(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, init);
}
