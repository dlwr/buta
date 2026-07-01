declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    SYNC_KV: KVNamespace;
    FEEDBIN_EMAIL: string;
    FEEDBIN_PASSWORD: string;
  }
}
