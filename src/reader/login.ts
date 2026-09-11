import type { Env } from "../env";
import { readerToken, parseClientLogin } from "./auth";
import { route, type Route } from "../api/router";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function handleClientLogin(request: Request, env: Env): Promise<Response> {
  const creds = parseClientLogin(await request.text());
  const valid = creds !== null && !!env.API_PASSWORD
    && timingSafeEqual(creds.email, env.API_EMAIL) && timingSafeEqual(creds.password, env.API_PASSWORD);
  if (!valid) return new Response("Error=BadAuthentication\n", { status: 403, headers: { "Content-Type": "text/plain" } });
  const token = await readerToken("auth", env.API_EMAIL, env.API_PASSWORD);
  return new Response(`SID=${token}\nLSID=${token}\nAuth=${token}\n`, { headers: { "Content-Type": "text/plain" } });
}

export const tokenRoutes: Route[] = [
  route("GET", /^\/reader\/api\/0\/token$/, async ({ env }) =>
    new Response(await readerToken("write", env.API_EMAIL, env.API_PASSWORD), { headers: { "Content-Type": "text/plain" } })),
];
