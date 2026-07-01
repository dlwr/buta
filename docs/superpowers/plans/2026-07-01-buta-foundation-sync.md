# buta Foundation (Feedbin 同期 + ストレージ) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cloudflare Worker が Feedbin API を定期同期し、entries / unread / starred / taggings を D1 にミラーする基盤を作る。

**Architecture:** Worker の Cron Trigger が `FeedbinClient`（Basic 認証・注入可能な fetch）で Feedbin から差分を取得し、D1 に upsert する。同期カーソルは KV に保持。全ロジックは fetch をスタブして純ユニットテスト可能に設計する。

**Tech Stack:** TypeScript (strict), Cloudflare Workers, D1, KV, vitest + `@cloudflare/vitest-pool-workers`, pnpm。

## Global Constraints

- パッケージマネージャは **pnpm**。
- 言語は **TypeScript**、`tsconfig` は `"strict": true`。
- Feedbin API ベース URL は `https://api.feedbin.com/v2`。認証は **HTTP Basic**（email:password）。
- Feedbin 資格情報は Worker の Secret（`FEEDBIN_EMAIL` / `FEEDBIN_PASSWORD`）。コードにハードコードしない。
- D1 バインディング名は `DB`、KV バインディング名は `SYNC_KV`。
- `entries?ids=` は 1 リクエスト最大 **100 件**、`unread_entries` の更新は 1 リクエスト最大 **1000 件**（この基盤では取得のみ）。
- テストはネットワークに出ない。`FeedbinClient` には常にスタブ `fetchFn` を注入する。
- コミットはタスクごと。TDD（失敗するテスト → 最小実装 → 通す）。

---

### Task 1: プロジェクトのスキャフォールド

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `wrangler.jsonc`
- Create: `vitest.config.ts`
- Create: `src/index.ts`
- Create: `test/smoke.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: 動作する `pnpm test`（vitest + workers pool）と Worker のエントリ雛形。

- [ ] **Step 1: `package.json` を作る**

```json
{
  "name": "buta",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "deploy": "wrangler deploy"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.5.0",
    "@cloudflare/workers-types": "^4.20240909.0",
    "typescript": "^5.5.0",
    "vitest": "~2.0.5",
    "wrangler": "^3.78.0"
  }
}
```

- [ ] **Step 2: `tsconfig.json` を作る**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: `wrangler.jsonc` を作る**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "buta",
  "main": "src/index.ts",
  "compatibility_date": "2026-06-01",
  "compatibility_flags": ["nodejs_compat"],
  "triggers": { "crons": ["*/5 * * * *"] },
  "d1_databases": [
    { "binding": "DB", "database_name": "buta", "database_id": "REPLACE_AFTER_CREATE" }
  ],
  "kv_namespaces": [
    { "binding": "SYNC_KV", "id": "REPLACE_AFTER_CREATE" }
  ]
}
```

- [ ] **Step 4: `vitest.config.ts` を作る**

```ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          d1Databases: ["DB"],
          kvNamespaces: ["SYNC_KV"],
        },
      },
    },
  },
});
```

- [ ] **Step 5: `src/index.ts` にエントリ雛形を作る**

```ts
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
```

- [ ] **Step 6: スモークテストを書く**

```ts
// test/smoke.test.ts
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 7: 依存をインストールしてテストが通ることを確認**

Run: `pnpm install && pnpm test`
Expected: PASS（`smoke > runs` が緑）。`pnpm typecheck` も通ること。

- [ ] **Step 8: コミット**

```bash
git add package.json tsconfig.json wrangler.jsonc vitest.config.ts src/index.ts test/smoke.test.ts pnpm-lock.yaml
git commit -m "chore: scaffold worker project with vitest workers pool"
```

---

### Task 2: Feedbin 型 と 認証チェック

**Files:**
- Create: `src/feedbin/types.ts`
- Create: `src/feedbin/client.ts`
- Test: `test/feedbin/client.auth.test.ts`

**Interfaces:**
- Produces:
  - `interface FeedbinEntry { id: number; feed_id: number; title: string | null; url: string | null; author: string | null; summary: string | null; content: string | null; published: string | null; created_at: string | null }`
  - `interface FeedbinTagging { id: number; feed_id: number; name: string }`
  - `interface FeedbinCredentials { email: string; password: string }`
  - `class FeedbinClient` — constructor `{ credentials: FeedbinCredentials; baseUrl?: string; fetchFn?: typeof fetch }`; method `verifyCredentials(): Promise<boolean>`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// test/feedbin/client.auth.test.ts
import { describe, it, expect, vi } from "vitest";
import { FeedbinClient } from "../../src/feedbin/client";

function fakeFetch(status: number) {
  return vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status }));
}

describe("FeedbinClient.verifyCredentials", () => {
  it("sends Basic auth to the authentication endpoint", async () => {
    const fetchFn = fakeFetch(200);
    const client = new FeedbinClient({
      credentials: { email: "a@b.com", password: "pw" },
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const ok = await client.verifyCredentials();

    expect(ok).toBe(true);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://api.feedbin.com/v2/authentication.json");
    const auth = (init!.headers as Record<string, string>)["Authorization"];
    expect(auth).toBe("Basic " + btoa("a@b.com:pw"));
  });

  it("returns false on 401", async () => {
    const client = new FeedbinClient({
      credentials: { email: "a@b.com", password: "wrong" },
      fetchFn: fakeFetch(401) as unknown as typeof fetch,
    });
    expect(await client.verifyCredentials()).toBe(false);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm vitest run test/feedbin/client.auth.test.ts`
Expected: FAIL（`Cannot find module '../../src/feedbin/client'`）

- [ ] **Step 3: 型を作る**

```ts
// src/feedbin/types.ts
export interface FeedbinEntry {
  id: number;
  feed_id: number;
  title: string | null;
  url: string | null;
  author: string | null;
  summary: string | null;
  content: string | null;
  published: string | null;
  created_at: string | null;
}

export interface FeedbinTagging {
  id: number;
  feed_id: number;
  name: string;
}

export interface FeedbinCredentials {
  email: string;
  password: string;
}
```

- [ ] **Step 4: クライアントに認証を実装**

```ts
// src/feedbin/client.ts
import type { FeedbinCredentials } from "./types";

export interface FeedbinClientOptions {
  credentials: FeedbinCredentials;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

const DEFAULT_BASE_URL = "https://api.feedbin.com/v2";

export class FeedbinClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly authHeader: string;

  constructor(opts: FeedbinClientOptions) {
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.authHeader =
      "Basic " + btoa(`${opts.credentials.email}:${opts.credentials.password}`);
  }

  protected async get(path: string): Promise<Response> {
    return this.fetchFn(`${this.baseUrl}${path}`, {
      method: "GET",
      headers: { Authorization: this.authHeader },
    });
  }

  async verifyCredentials(): Promise<boolean> {
    const res = await this.get("/authentication.json");
    return res.status === 200;
  }
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm vitest run test/feedbin/client.auth.test.ts`
Expected: PASS（両ケース緑）

- [ ] **Step 6: コミット**

```bash
git add src/feedbin/types.ts src/feedbin/client.ts test/feedbin/client.auth.test.ts
git commit -m "feat(feedbin): typed client with basic-auth credential check"
```

---

### Task 3: 未読 / スター の entry_id 取得

**Files:**
- Modify: `src/feedbin/client.ts`
- Test: `test/feedbin/client.ids.test.ts`

**Interfaces:**
- Consumes: `FeedbinClient` (Task 2)
- Produces: `getUnreadEntryIds(): Promise<number[]>`、`getStarredEntryIds(): Promise<number[]>`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// test/feedbin/client.ids.test.ts
import { describe, it, expect, vi } from "vitest";
import { FeedbinClient } from "../../src/feedbin/client";

function jsonFetch(body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  }));
}

function client(fetchFn: typeof fetch) {
  return new FeedbinClient({ credentials: { email: "a@b.com", password: "pw" }, fetchFn });
}

describe("FeedbinClient id endpoints", () => {
  it("getUnreadEntryIds returns the id array", async () => {
    const fetchFn = jsonFetch([4087, 4088, 4089]);
    const ids = await client(fetchFn as unknown as typeof fetch).getUnreadEntryIds();
    expect(ids).toEqual([4087, 4088, 4089]);
    expect(fetchFn.mock.calls[0]![0]).toBe("https://api.feedbin.com/v2/unread_entries.json");
  });

  it("getStarredEntryIds hits the starred endpoint", async () => {
    const fetchFn = jsonFetch([11, 22]);
    const ids = await client(fetchFn as unknown as typeof fetch).getStarredEntryIds();
    expect(ids).toEqual([11, 22]);
    expect(fetchFn.mock.calls[0]![0]).toBe("https://api.feedbin.com/v2/starred_entries.json");
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm vitest run test/feedbin/client.ids.test.ts`
Expected: FAIL（`getUnreadEntryIds is not a function`）

- [ ] **Step 3: 実装を追加**

`src/feedbin/client.ts` の `verifyCredentials` の下にメソッドを追加：

```ts
  private async getJson<T>(path: string): Promise<T> {
    const res = await this.get(path);
    if (!res.ok) {
      throw new Error(`Feedbin GET ${path} failed: ${res.status}`);
    }
    return (await res.json()) as T;
  }

  async getUnreadEntryIds(): Promise<number[]> {
    return this.getJson<number[]>("/unread_entries.json");
  }

  async getStarredEntryIds(): Promise<number[]> {
    return this.getJson<number[]>("/starred_entries.json");
  }
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm vitest run test/feedbin/client.ids.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/feedbin/client.ts test/feedbin/client.ids.test.ts
git commit -m "feat(feedbin): fetch unread and starred entry ids"
```

---

### Task 4: taggings（フォルダ/タグ）取得

**Files:**
- Modify: `src/feedbin/client.ts`
- Test: `test/feedbin/client.taggings.test.ts`

**Interfaces:**
- Consumes: `FeedbinClient`, `FeedbinTagging`
- Produces: `getTaggings(): Promise<FeedbinTagging[]>`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// test/feedbin/client.taggings.test.ts
import { describe, it, expect, vi } from "vitest";
import { FeedbinClient } from "../../src/feedbin/client";

describe("FeedbinClient.getTaggings", () => {
  it("returns taggings", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify([
      { id: 4, feed_id: 1, name: "Core" },
      { id: 5, feed_id: 2, name: "News" },
    ]), { status: 200, headers: { "content-type": "application/json" } }));

    const client = new FeedbinClient({
      credentials: { email: "a@b.com", password: "pw" },
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const taggings = await client.getTaggings();
    expect(taggings).toHaveLength(2);
    expect(taggings[0]).toEqual({ id: 4, feed_id: 1, name: "Core" });
    expect(fetchFn.mock.calls[0]![0]).toBe("https://api.feedbin.com/v2/taggings.json");
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm vitest run test/feedbin/client.taggings.test.ts`
Expected: FAIL（`getTaggings is not a function`）

- [ ] **Step 3: 実装を追加**

`src/feedbin/client.ts` の import に型を追加し、メソッドを実装：

```ts
import type { FeedbinCredentials, FeedbinTagging } from "./types";
```

```ts
  async getTaggings(): Promise<FeedbinTagging[]> {
    return this.getJson<FeedbinTagging[]>("/taggings.json");
  }
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm vitest run test/feedbin/client.taggings.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/feedbin/client.ts test/feedbin/client.taggings.test.ts
git commit -m "feat(feedbin): fetch taggings"
```

---

### Task 5: entries を id 指定で取得（100件バッチ）

**Files:**
- Modify: `src/feedbin/client.ts`
- Test: `test/feedbin/client.entries.test.ts`

**Interfaces:**
- Consumes: `FeedbinClient`, `FeedbinEntry`
- Produces: `getEntriesByIds(ids: number[]): Promise<FeedbinEntry[]>` — 100 件ずつに分割して `?ids=` で取得し結合する。空配列なら fetch せず `[]`。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// test/feedbin/client.entries.test.ts
import { describe, it, expect, vi } from "vitest";
import { FeedbinClient } from "../../src/feedbin/client";
import type { FeedbinEntry } from "../../src/feedbin/types";

function entry(id: number): FeedbinEntry {
  return {
    id, feed_id: 1, title: `t${id}`, url: `http://x/${id}`, author: null,
    summary: "s", content: "c", published: null, created_at: "2026-07-01T00:00:00Z",
  };
}

describe("FeedbinClient.getEntriesByIds", () => {
  it("returns [] without fetching when ids is empty", async () => {
    const fetchFn = vi.fn();
    const client = new FeedbinClient({
      credentials: { email: "a@b.com", password: "pw" },
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(await client.getEntriesByIds([])).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("splits into batches of 100 and concatenates", async () => {
    const ids = Array.from({ length: 150 }, (_, i) => i + 1);
    const fetchFn = vi.fn(async (url: string) => {
      const idsParam = new URL(url).searchParams.get("ids")!;
      const batch = idsParam.split(",").map(Number).map(entry);
      return new Response(JSON.stringify(batch), {
        status: 200, headers: { "content-type": "application/json" },
      });
    });
    const client = new FeedbinClient({
      credentials: { email: "a@b.com", password: "pw" },
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const result = await client.getEntriesByIds(ids);

    expect(result).toHaveLength(150);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const firstIds = new URL(fetchFn.mock.calls[0]![0] as string).searchParams.get("ids")!.split(",");
    expect(firstIds).toHaveLength(100);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm vitest run test/feedbin/client.entries.test.ts`
Expected: FAIL（`getEntriesByIds is not a function`）

- [ ] **Step 3: 実装を追加**

import を更新：

```ts
import type { FeedbinCredentials, FeedbinEntry, FeedbinTagging } from "./types";
```

メソッドを実装：

```ts
  async getEntriesByIds(ids: number[]): Promise<FeedbinEntry[]> {
    const out: FeedbinEntry[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      const entries = await this.getJson<FeedbinEntry[]>(
        `/entries.json?ids=${batch.join(",")}`,
      );
      out.push(...entries);
    }
    return out;
  }
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm vitest run test/feedbin/client.entries.test.ts`
Expected: PASS（150件、2バッチ）

- [ ] **Step 5: コミット**

```bash
git add src/feedbin/client.ts test/feedbin/client.entries.test.ts
git commit -m "feat(feedbin): fetch entries by ids in batches of 100"
```

---

### Task 6: D1 スキーマ と クエリヘルパー

**Files:**
- Create: `src/db/schema.ts`
- Create: `src/db/queries.ts`
- Test: `test/db/queries.test.ts`

**Interfaces:**
- Consumes: `FeedbinEntry`, `FeedbinTagging`, D1 バインディング `DB`
- Produces:
  - `SCHEMA_STATEMENTS: string[]`
  - `initSchema(db: D1Database): Promise<void>`
  - `upsertTaggings(db: D1Database, taggings: FeedbinTagging[]): Promise<void>` — 全置換（DELETE 後 INSERT）
  - `upsertEntries(db: D1Database, entries: FeedbinEntry[], syncedAt: string): Promise<void>` — id 衝突は本文を更新、既存の `is_unread` / `is_starred` は保持
  - `setUnreadFlags(db: D1Database, unreadIds: number[]): Promise<void>` — 追跡中 entry のうち unreadIds のみ `is_unread=1`、他は 0
  - `setStarredFlags(db: D1Database, starredIds: number[]): Promise<void>` — 同様に `is_starred`
  - `getTrackedEntryIds(db: D1Database): Promise<Set<number>>`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// test/db/queries.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import {
  initSchema, upsertEntries, upsertTaggings,
  setUnreadFlags, setStarredFlags, getTrackedEntryIds,
} from "../../src/db/queries";
import type { FeedbinEntry } from "../../src/feedbin/types";

function entry(id: number, over: Partial<FeedbinEntry> = {}): FeedbinEntry {
  return {
    id, feed_id: 1, title: `t${id}`, url: `http://x/${id}`, author: null,
    summary: "s", content: "c", published: null, created_at: "2026-07-01T00:00:00Z",
    ...over,
  };
}

beforeEach(async () => {
  await initSchema(env.DB);
  await env.DB.exec("DELETE FROM entries");
  await env.DB.exec("DELETE FROM taggings");
});

describe("queries", () => {
  it("upsertTaggings replaces existing rows", async () => {
    await upsertTaggings(env.DB, [{ id: 4, feed_id: 1, name: "Core" }]);
    await upsertTaggings(env.DB, [{ id: 5, feed_id: 2, name: "News" }]);
    const { results } = await env.DB.prepare("SELECT id, name FROM taggings ORDER BY id").all();
    expect(results).toEqual([{ id: 5, name: "News" }]);
  });

  it("upsertEntries inserts and getTrackedEntryIds returns them", async () => {
    await upsertEntries(env.DB, [entry(1), entry(2)], "2026-07-01T00:00:00Z");
    const ids = await getTrackedEntryIds(env.DB);
    expect([...ids].sort()).toEqual([1, 2]);
  });

  it("upsertEntries preserves is_unread/is_starred on re-sync", async () => {
    await upsertEntries(env.DB, [entry(1)], "2026-07-01T00:00:00Z");
    await setUnreadFlags(env.DB, []);          // mark id 1 as read
    await setStarredFlags(env.DB, [1]);        // star id 1
    await upsertEntries(env.DB, [entry(1, { title: "updated" })], "2026-07-02T00:00:00Z");
    const row = await env.DB.prepare(
      "SELECT title, is_unread, is_starred FROM entries WHERE id = 1",
    ).first<{ title: string; is_unread: number; is_starred: number }>();
    expect(row).toEqual({ title: "updated", is_unread: 0, is_starred: 1 });
  });

  it("setUnreadFlags marks only listed ids unread", async () => {
    await upsertEntries(env.DB, [entry(1), entry(2), entry(3)], "2026-07-01T00:00:00Z");
    await setUnreadFlags(env.DB, [2]);
    const rows = await env.DB.prepare(
      "SELECT id, is_unread FROM entries ORDER BY id",
    ).all();
    expect(rows.results).toEqual([
      { id: 1, is_unread: 0 }, { id: 2, is_unread: 1 }, { id: 3, is_unread: 0 },
    ]);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm vitest run test/db/queries.test.ts`
Expected: FAIL（`Cannot find module '../../src/db/queries'`）

- [ ] **Step 3: スキーマを作る**

```ts
// src/db/schema.ts
export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS taggings (
     id INTEGER PRIMARY KEY,
     feed_id INTEGER NOT NULL,
     name TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_taggings_feed ON taggings(feed_id)`,
  `CREATE TABLE IF NOT EXISTS entries (
     id INTEGER PRIMARY KEY,
     feed_id INTEGER NOT NULL,
     title TEXT,
     url TEXT,
     author TEXT,
     summary TEXT,
     content TEXT,
     published TEXT,
     created_at TEXT,
     is_unread INTEGER NOT NULL DEFAULT 1,
     is_starred INTEGER NOT NULL DEFAULT 0,
     synced_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_entries_feed ON entries(feed_id)`,
  `CREATE INDEX IF NOT EXISTS idx_entries_unread ON entries(is_unread)`,
];
```

- [ ] **Step 4: クエリヘルパーを実装**

```ts
// src/db/queries.ts
import { SCHEMA_STATEMENTS } from "./schema";
import type { FeedbinEntry, FeedbinTagging } from "../feedbin/types";

export async function initSchema(db: D1Database): Promise<void> {
  for (const stmt of SCHEMA_STATEMENTS) {
    await db.exec(stmt.replace(/\s+/g, " ").trim());
  }
}

export async function upsertTaggings(
  db: D1Database, taggings: FeedbinTagging[],
): Promise<void> {
  await db.prepare("DELETE FROM taggings").run();
  if (taggings.length === 0) return;
  const stmt = db.prepare("INSERT INTO taggings (id, feed_id, name) VALUES (?, ?, ?)");
  await db.batch(taggings.map((t) => stmt.bind(t.id, t.feed_id, t.name)));
}

export async function upsertEntries(
  db: D1Database, entries: FeedbinEntry[], syncedAt: string,
): Promise<void> {
  if (entries.length === 0) return;
  const stmt = db.prepare(
    `INSERT INTO entries
       (id, feed_id, title, url, author, summary, content, published, created_at, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       feed_id=excluded.feed_id, title=excluded.title, url=excluded.url,
       author=excluded.author, summary=excluded.summary, content=excluded.content,
       published=excluded.published, created_at=excluded.created_at,
       synced_at=excluded.synced_at`,
  );
  await db.batch(entries.map((e) => stmt.bind(
    e.id, e.feed_id, e.title, e.url, e.author, e.summary, e.content,
    e.published, e.created_at, syncedAt,
  )));
}

async function setFlagFromIds(
  db: D1Database, column: "is_unread" | "is_starred", ids: number[],
): Promise<void> {
  await db.prepare(`UPDATE entries SET ${column} = 0`).run();
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(",");
  await db.prepare(
    `UPDATE entries SET ${column} = 1 WHERE id IN (${placeholders})`,
  ).bind(...ids).run();
}

export async function setUnreadFlags(db: D1Database, unreadIds: number[]): Promise<void> {
  await setFlagFromIds(db, "is_unread", unreadIds);
}

export async function setStarredFlags(db: D1Database, starredIds: number[]): Promise<void> {
  await setFlagFromIds(db, "is_starred", starredIds);
}

export async function getTrackedEntryIds(db: D1Database): Promise<Set<number>> {
  const { results } = await db.prepare("SELECT id FROM entries").all<{ id: number }>();
  return new Set(results.map((r) => r.id));
}
```

> 注意: `setUnreadFlags` / `setStarredFlags` は「追跡中の全 entry を 0 にしてから列挙 id を 1 にする」全走査。基盤では単純さ優先。将来 entry 数が大きくなり性能が問題化したら差分更新に置き換える（YAGNI なので今はしない）。

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm vitest run test/db/queries.test.ts`
Expected: PASS（4ケース緑）

- [ ] **Step 6: コミット**

```bash
git add src/db/schema.ts src/db/queries.ts test/db/queries.test.ts
git commit -m "feat(db): d1 schema and upsert/flag query helpers"
```

---

### Task 7: 同期オーケストレーション

**Files:**
- Create: `src/sync/sync.ts`
- Test: `test/sync/sync.test.ts`

**Interfaces:**
- Consumes: `FeedbinClient`（Task 2-5）、`src/db/queries`（Task 6）、KV `SYNC_KV`
- Produces: `syncAll(deps: SyncDeps): Promise<SyncResult>`
  - `interface SyncDeps { db: D1Database; kv: KVNamespace; client: Pick<FeedbinClient, "getTaggings" | "getUnreadEntryIds" | "getStarredEntryIds" | "getEntriesByIds">; now: () => string }`
  - `interface SyncResult { hydrated: number; unread: number; starred: number }`
  - 動作: taggings 取得→保存。unread + starred の id を取得し和集合のうち **未追跡 id だけ** entries をハイドレート→upsert。unread/starred フラグを反映。`SYNC_KV` に `last_sync` = `now()` を書く。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// test/sync/sync.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { syncAll } from "../../src/sync/sync";
import { initSchema, upsertEntries, getTrackedEntryIds } from "../../src/db/queries";
import type { FeedbinEntry, FeedbinTagging } from "../../src/feedbin/types";

function entry(id: number): FeedbinEntry {
  return {
    id, feed_id: 1, title: `t${id}`, url: `http://x/${id}`, author: null,
    summary: "s", content: "c", published: null, created_at: "2026-07-01T00:00:00Z",
  };
}

function fakeClient(over: {
  taggings?: FeedbinTagging[]; unread?: number[]; starred?: number[];
} = {}) {
  const hydrated: number[][] = [];
  return {
    hydrated,
    async getTaggings() { return over.taggings ?? []; },
    async getUnreadEntryIds() { return over.unread ?? []; },
    async getStarredEntryIds() { return over.starred ?? []; },
    async getEntriesByIds(ids: number[]) { hydrated.push(ids); return ids.map(entry); },
  };
}

beforeEach(async () => {
  await initSchema(env.DB);
  await env.DB.exec("DELETE FROM entries");
  await env.DB.exec("DELETE FROM taggings");
});

describe("syncAll", () => {
  it("hydrates only untracked ids and records flags", async () => {
    await upsertEntries(env.DB, [entry(1)], "2026-06-30T00:00:00Z"); // already tracked
    const client = fakeClient({
      taggings: [{ id: 4, feed_id: 1, name: "Core" }],
      unread: [1, 2, 3],
      starred: [2],
    });

    const result = await syncAll({
      db: env.DB, kv: env.SYNC_KV, client, now: () => "2026-07-01T12:00:00Z",
    });

    // id 1 は既存なので、ハイドレートは 2,3 のみ
    expect(client.hydrated).toEqual([[2, 3]]);
    expect(result).toEqual({ hydrated: 2, unread: 3, starred: 1 });

    const tracked = await getTrackedEntryIds(env.DB);
    expect([...tracked].sort()).toEqual([1, 2, 3]);

    const flags = await env.DB.prepare(
      "SELECT id, is_unread, is_starred FROM entries ORDER BY id",
    ).all();
    expect(flags.results).toEqual([
      { id: 1, is_unread: 1, is_starred: 0 },
      { id: 2, is_unread: 1, is_starred: 1 },
      { id: 3, is_unread: 1, is_starred: 0 },
    ]);

    expect(await env.SYNC_KV.get("last_sync")).toBe("2026-07-01T12:00:00Z");
  });

  it("hydrates nothing when all ids already tracked", async () => {
    await upsertEntries(env.DB, [entry(1), entry(2)], "2026-06-30T00:00:00Z");
    const client = fakeClient({ unread: [1, 2], starred: [] });
    const result = await syncAll({
      db: env.DB, kv: env.SYNC_KV, client, now: () => "2026-07-01T12:00:00Z",
    });
    expect(client.hydrated).toEqual([]);
    expect(result.hydrated).toBe(0);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm vitest run test/sync/sync.test.ts`
Expected: FAIL（`Cannot find module '../../src/sync/sync'`）

- [ ] **Step 3: 実装**

```ts
// src/sync/sync.ts
import type { FeedbinClient } from "../feedbin/client";
import {
  upsertTaggings, upsertEntries, setUnreadFlags, setStarredFlags, getTrackedEntryIds,
} from "../db/queries";

export interface SyncDeps {
  db: D1Database;
  kv: KVNamespace;
  client: Pick<
    FeedbinClient,
    "getTaggings" | "getUnreadEntryIds" | "getStarredEntryIds" | "getEntriesByIds"
  >;
  now: () => string;
}

export interface SyncResult {
  hydrated: number;
  unread: number;
  starred: number;
}

export async function syncAll(deps: SyncDeps): Promise<SyncResult> {
  const { db, kv, client, now } = deps;
  const syncedAt = now();

  const taggings = await client.getTaggings();
  await upsertTaggings(db, taggings);

  const [unreadIds, starredIds] = await Promise.all([
    client.getUnreadEntryIds(),
    client.getStarredEntryIds(),
  ]);

  const wanted = new Set<number>([...unreadIds, ...starredIds]);
  const tracked = await getTrackedEntryIds(db);
  const missing = [...wanted].filter((id) => !tracked.has(id));

  const hydratedEntries = await client.getEntriesByIds(missing);
  await upsertEntries(db, hydratedEntries, syncedAt);

  await setUnreadFlags(db, unreadIds);
  await setStarredFlags(db, starredIds);

  await kv.put("last_sync", syncedAt);

  return { hydrated: hydratedEntries.length, unread: unreadIds.length, starred: starredIds.length };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm vitest run test/sync/sync.test.ts`
Expected: PASS（両ケース緑）

- [ ] **Step 5: コミット**

```bash
git add src/sync/sync.ts test/sync/sync.test.ts
git commit -m "feat(sync): orchestrate feedbin sync into d1"
```

---

### Task 8: Worker 配線（Cron + ヘルスルート）

**Files:**
- Modify: `src/index.ts`
- Test: `test/index.test.ts`

**Interfaces:**
- Consumes: `Env`（Task 1）、`FeedbinClient`、`syncAll`、`initSchema`
- Produces: `scheduled` ハンドラ（Cron 起動で `syncAll` を実行）と `fetch` の `GET /health`（`{ ok: true }` を返す）。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// test/index.test.ts
import { describe, it, expect } from "vitest";
import worker from "../src/index";

describe("worker fetch", () => {
  it("GET /health returns ok", async () => {
    const res = await worker.fetch(
      new Request("https://buta.example/health"),
      {} as never,
      {} as never,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("unknown path returns 404", async () => {
    const res = await worker.fetch(
      new Request("https://buta.example/nope"),
      {} as never,
      {} as never,
    );
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm vitest run test/index.test.ts`
Expected: FAIL（現状 `fetch` は常に `"buta"` を 200 で返し、`/health` の JSON も 404 も無い）

- [ ] **Step 3: 実装**

```ts
// src/index.ts
import { FeedbinClient } from "./feedbin/client";
import { initSchema } from "./db/queries";
import { syncAll } from "./sync/sync";

export interface Env {
  DB: D1Database;
  SYNC_KV: KVNamespace;
  FEEDBIN_EMAIL: string;
  FEEDBIN_PASSWORD: string;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true });
    }
    return new Response("Not Found", { status: 404 });
  },

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await initSchema(env.DB);
    const client = new FeedbinClient({
      credentials: { email: env.FEEDBIN_EMAIL, password: env.FEEDBIN_PASSWORD },
    });
    const result = await syncAll({
      db: env.DB,
      kv: env.SYNC_KV,
      client,
      now: () => new Date().toISOString(),
    });
    console.log("sync complete", result);
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm vitest run test/index.test.ts`
Expected: PASS（両ケース緑）

- [ ] **Step 5: 全テスト + 型チェック**

Run: `pnpm test && pnpm typecheck`
Expected: 全て PASS

- [ ] **Step 6: コミット**

```bash
git add src/index.ts test/index.test.ts
git commit -m "feat: wire scheduled sync handler and health route"
```

---

### Task 9: 実 Feedbin での手動疎通（本番リソース作成）

このタスクは自動テストではなく、実インフラでの疎通確認。実行者（あなた）の操作が要る。

**Files:**
- Modify: `wrangler.jsonc`（作成した D1 / KV の id を反映）

- [ ] **Step 1: D1 と KV を作成**

```bash
pnpm wrangler d1 create buta
pnpm wrangler kv namespace create SYNC_KV
```

出力された `database_id` と KV `id` を `wrangler.jsonc` の `REPLACE_AFTER_CREATE` に反映する。

- [ ] **Step 2: スキーマを本番 D1 に適用**

`scheduled` が `initSchema` を呼ぶので初回 Cron で作られるが、手動で先に流してもよい：

```bash
pnpm wrangler d1 execute buta --remote --command \
  "CREATE TABLE IF NOT EXISTS entries (id INTEGER PRIMARY KEY, feed_id INTEGER NOT NULL, title TEXT, url TEXT, author TEXT, summary TEXT, content TEXT, published TEXT, created_at TEXT, is_unread INTEGER NOT NULL DEFAULT 1, is_starred INTEGER NOT NULL DEFAULT 0, synced_at TEXT NOT NULL)"
```

- [ ] **Step 3: Feedbin 資格情報を Secret 登録**

```bash
pnpm wrangler secret put FEEDBIN_EMAIL
pnpm wrangler secret put FEEDBIN_PASSWORD
```

- [ ] **Step 4: デプロイして Cron を手動発火**

```bash
pnpm deploy
pnpm wrangler dev --test-scheduled
# 別シェルで:
curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"
```

- [ ] **Step 5: D1 に実データが入ったことを確認**

```bash
pnpm wrangler d1 execute buta --remote --command \
  "SELECT count(*) AS n, sum(is_unread) AS unread, sum(is_starred) AS starred FROM entries"
```
Expected: `n` が実際の追跡件数、`unread` が Feedbin の未読数と概ね一致。

- [ ] **Step 6: 疎通確認結果を記録してコミット**

```bash
git add wrangler.jsonc
git commit -m "chore: bind production d1 and kv resources"
```

---

## Self-Review

**1. Spec coverage（DESIGN.md の Foundation 相当）:**
- Feedbin Basic 認証 → Task 2 ✓
- unread / starred id 取得 → Task 3 ✓
- taggings（Tier/重みの元）取得 → Task 4 ✓
- entries 100件バッチ取得（summary/content 含む）→ Task 5 ✓
- D1 ミラー（entries/taggings）+ 状態フラグ → Task 6 ✓
- since 差分の代替（未追跡 id のみハイドレート）→ Task 7 ✓（注: 真の `since` 増分取得は選別エンジン以降で最適化。今は「未追跡のみ取得」で転送を抑える）
- Cron 同期 + KV カーソル → Task 7 / Task 8 ✓
- 実 Feedbin 疎通 → Task 9 ✓
- **この基盤の非対象**: 選別ロジック（Tier/サンプリング/dedup）、BFF 配信 API、既読/スター**書き戻し**、PWA。すべて後続プラン。

**2. Placeholder scan:** 各ステップに実コードあり。「エラー処理を追加」等の曖昧指示なし。Task 6 の全走査フラグ更新は意図的な単純化として明記済み。

**3. Type consistency:** `FeedbinEntry` / `FeedbinTagging` の列名は D1 スキーマ・クエリ・sync で一致。`syncAll` の `SyncResult` はテストの期待と一致。`client` は `Pick<FeedbinClient, ...>` で必要メソッドのみ依存。

---

## 未解決（このプランの範囲外・次プランで扱う）

- 真の増分同期（`entries.json?since=` と `updated_entries` によるフラグ変更の追随）。今は unread/starred の全 id 取得で状態を再構築している。件数が増えたら `updated_entries.json` ベースに移行。
- 追跡から外れた（既読になり Feedbin 側で更新も無い）古い entry の retention / 掃除ポリシー。
