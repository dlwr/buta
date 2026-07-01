export interface Env {
  DB: D1Database;
  SYNC_KV: KVNamespace;
  FEEDBIN_EMAIL: string;
  FEEDBIN_PASSWORD: string;
}

export default {
  async fetch(): Promise<Response> {
    return new Response("buta", { status: 200 });
  },
} satisfies ExportedHandler<Env>;
