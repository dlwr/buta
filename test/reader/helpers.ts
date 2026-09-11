import { env } from "cloudflare:test";
import worker from "../../src/index";
import { readerToken } from "../../src/reader/auth";

export async function readerCall(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await readerToken("auth", env.API_EMAIL, env.API_PASSWORD);
  const headers = { Authorization: `GoogleLogin auth=${token}`, ...((init.headers as Record<string, string> | undefined) ?? {}) };
  return worker.fetch(new Request(`https://buta.test${path}`, { ...init, headers }), env);
}

export async function readerPost(path: string, form: Record<string, string | string[]>): Promise<Response> {
  const body = new URLSearchParams();
  body.set("T", await readerToken("write", env.API_EMAIL, env.API_PASSWORD));
  for (const [k, v] of Object.entries(form)) {
    for (const item of Array.isArray(v) ? v : [v]) body.append(k, item);
  }
  return readerCall(path, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
}
