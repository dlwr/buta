import type { Env } from "./env";

export default {
  async fetch(_request: Request, _env: Env): Promise<Response> {
    return new Response("Not Found", { status: 404 });
  },
  async scheduled(_event: ScheduledController, _env: Env): Promise<void> {},
} satisfies ExportedHandler<Env>;
