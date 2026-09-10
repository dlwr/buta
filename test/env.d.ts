import type { D1Migration } from "@cloudflare/vitest-pool-workers";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    SYNC_KV: KVNamespace;
    API_EMAIL: string;
    API_PASSWORD: string;
    ADMIN_TOKEN: string;
    TEST_MIGRATIONS: D1Migration[];
  }
}
