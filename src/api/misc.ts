import { route, json } from "./router";

export const miscRoutes = [
  route("GET", /^\/v2\/authentication\.json$/, async () => new Response(null, { status: 200 })),
  route("GET", /^\/v2\/icons\.json$/, async () => json([])),
  route("GET", /^\/v2\/saved_searches\.json$/, async () => json([])),
  route("POST", /^\/v2\/pages\.json$/, async () => new Response("Not Implemented", { status: 501 })),
];
