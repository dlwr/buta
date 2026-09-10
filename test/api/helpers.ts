import { env } from "cloudflare:test";
import worker from "../../src/index";

export const AUTH = { Authorization: "Basic " + btoa("me@example.com:pw") };

export function call(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = { ...AUTH, ...((init.headers as Record<string, string> | undefined) ?? {}) };
  return worker.fetch(new Request(`https://buta.test${path}`, { ...init, headers }), env);
}

export function jsonReq(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
