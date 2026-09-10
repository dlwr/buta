import path from "node:path";
import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, "migrations"));
  return {
    test: {
      setupFiles: ["./test/setup.ts"],
      poolOptions: {
        workers: {
          wrangler: { configPath: "./wrangler.jsonc" },
          miniflare: {
            d1Databases: ["DB"],
            kvNamespaces: ["SYNC_KV"],
            bindings: {
              ADMIN_TOKEN: "test-token",
              API_EMAIL: "me@example.com",
              API_PASSWORD: "pw",
              TEST_MIGRATIONS: migrations,
            },
          },
        },
      },
    },
  };
});
