# buta 選別エンジン (Selection Engine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** D1 ミラー（entries + taggings + feed_state）から二層選別リスト（Tier 1 = Must Read 全件 / Tier 2 = アンチスタベーション×幅優先サンプリング）を組み立て、読み取り専用エンドポイントで配信する。合わせて、選別のチューニングを回すためのデバッグ足回りを整える。

**Architecture:** 選別ロジックは**純粋な TS 関数**（D1 から単一テーブル SELECT で取った in-memory データを処理）。複雑な SQL JOIN は使わない（テスト容易 + D1 の癖回避）。配信は既存の bare fetch ルーティングに `GET /feed` を追加。オンデマンド同期 `POST /admin/sync` でチューニングを秒で回す。

**Tech Stack:** TypeScript (strict), Cloudflare Workers, D1, vitest + `@cloudflare/vitest-pool-workers`, pnpm。Foundation プラン（`2026-07-01-buta-foundation-sync.md`）の上に載る。

## Global Constraints

- Foundation の成果物（`src/feedbin/*`, `src/db/*`, `src/sync/*`, `src/index.ts`）が存在し、19 テストが緑である前提。
- **D1 の 1 文あたりバインド変数上限は ~100**。`IN (?,?,…)` は 90/文でチャンクし `db.batch`（Foundation の `setFlagFromIds` 参照）。
- 選別ロジックは**純関数**に閉じる。D1 アクセスは `src/db/queries.ts` に単一テーブル SELECT で足す。
- **状態は 2 値（未読/既読）のみ**。`last_surfaced` は feed 単位、`feed_state` テーブルに持つ。この plan では**読むだけ**（更新＝ビュー報告は plan 3）。
- `created_at` / `last_surfaced` は ISO8601 文字列。同形式なので**辞書順比較でよい**（Date パース不要）。null は最小として扱う。
- 選別の既定値: `coreTags=["Must Read"]`, `tailBudget=30`, `perFeedCap=3`, **幅優先＝原則 1 フィード 1 件**。
- テストはネットワークに出ない。
- コミットはタスクごと。TDD。

---

### Task 1: オンデマンド同期トリガー（POST /admin/sync）

5 分 cron を待たずに同期を発火し、選別チューニングを秒で回すための足回り。トークンで保護する。

**Files:**
- Modify: `src/index.ts`
- Test: `test/admin-sync.test.ts`

**Interfaces:**
- Consumes: `Env`（`ADMIN_TOKEN` を追加）、`initSchema`, `FeedbinClient`, `syncAll`
- Produces: `POST /admin/sync`（`Authorization: Bearer <ADMIN_TOKEN>` 必須）。成功で `syncAll` を実行し `SyncResult` を JSON 返却。トークン不一致/欠如は 401。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// test/admin-sync.test.ts
import { describe, it, expect } from "vitest";
import worker from "../src/index";

const baseEnv = {
  DB: {} as never, SYNC_KV: {} as never,
  FEEDBIN_EMAIL: "", FEEDBIN_PASSWORD: "", ADMIN_TOKEN: "secret",
};

describe("POST /admin/sync auth", () => {
  it("401 without a valid token", async () => {
    const res = await worker.fetch(
      new Request("https://buta.example/admin/sync", { method: "POST" }),
      baseEnv as never, {} as never,
    );
    expect(res.status).toBe(401);
  });

  it("rejects a wrong token", async () => {
    const res = await worker.fetch(
      new Request("https://buta.example/admin/sync", {
        method: "POST", headers: { Authorization: "Bearer nope" },
      }),
      baseEnv as never, {} as never,
    );
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm vitest run test/admin-sync.test.ts`
Expected: FAIL（現状 `/admin/sync` は 404 を返す）

- [ ] **Step 3: 実装**

`src/index.ts` の `Env` に `ADMIN_TOKEN: string;` を追加し、`fetch` のルーティングを拡張する。`import` に既存の `FeedbinClient`, `initSchema`, `syncAll` があることを確認（Foundation で追加済み）。

```ts
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true });
    }

    if (request.method === "POST" && url.pathname === "/admin/sync") {
      if (request.headers.get("Authorization") !== `Bearer ${env.ADMIN_TOKEN}`) {
        return new Response("Unauthorized", { status: 401 });
      }
      const result = await runSync(env);
      return Response.json(result);
    }

    return new Response("Not Found", { status: 404 });
  },
```

`scheduled` と共有するため、同期処理を関数に抽出する（ファイル末尾、`export default` の外）：

```ts
async function runSync(env: Env) {
  await initSchema(env.DB);
  const client = new FeedbinClient({
    credentials: { email: env.FEEDBIN_EMAIL, password: env.FEEDBIN_PASSWORD },
  });
  return syncAll({
    db: env.DB, kv: env.SYNC_KV, client,
    now: () => new Date().toISOString(),
  });
}
```

`scheduled` を `runSync` を使う形に置き換える：

```ts
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const result = await runSync(env);
    console.log("sync complete", result);
  },
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm vitest run test/admin-sync.test.ts`
Expected: PASS（401 の 2 ケース）

- [ ] **Step 5: `env.d.ts` に ADMIN_TOKEN を追加**

`test/env.d.ts` の `ProvidedEnv` に `ADMIN_TOKEN: string;` を追加（型チェック用）。

- [ ] **Step 6: 型チェック + コミット**

Run: `pnpm typecheck`
Expected: PASS

```bash
git add src/index.ts test/admin-sync.test.ts test/env.d.ts
git commit -m "feat: on-demand sync trigger (POST /admin/sync, token-guarded)"
```

---

### Task 2: 現実スケールの同期統合テスト

Foundation のバグ（大量 id で `too many SQL variables`）は、テストが小さい id リストしか使わなかったから見逃された。数千 id で `syncAll` を端から端まで回す統合テストで盲点を塞ぐ。

**Files:**
- Test: `test/sync/sync.integration.test.ts`

**Interfaces:**
- Consumes: `syncAll`, `initSchema`, 実 `env.DB` / `env.SYNC_KV`

- [ ] **Step 1: 失敗する（＝退行検知用の）テストを書く**

```ts
// test/sync/sync.integration.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { syncAll } from "../../src/sync/sync";
import { initSchema } from "../../src/db/queries";
import type { FeedbinEntry, FeedbinTagging } from "../../src/feedbin/types";

function bigClient(n: number) {
  const unread = Array.from({ length: n }, (_, i) => i + 1);
  const taggings: FeedbinTagging[] = Array.from({ length: 500 }, (_, i) => ({
    id: i + 1, feed_id: (i % 50) + 1, name: i % 5 === 0 ? "Must Read" : "Blog",
  }));
  return {
    async getTaggings() { return taggings; },
    async getUnreadEntryIds() { return unread; },
    async getStarredEntryIds() { return unread.slice(0, 200); },
    async getEntriesByIds(ids: number[]): Promise<FeedbinEntry[]> {
      return ids.map((id) => ({
        id, feed_id: (id % 50) + 1, title: `t${id}`, url: `http://x/${id}`,
        author: null, summary: "s", content: "c", published: null,
        created_at: "2026-07-01T00:00:00Z",
      }));
    },
  };
}

beforeEach(async () => {
  await initSchema(env.DB);
  await env.DB.exec("DELETE FROM entries");
  await env.DB.exec("DELETE FROM taggings");
});

describe("syncAll at realistic scale", () => {
  it("syncs 2500 unread end-to-end without hitting SQL-variable limits", async () => {
    const result = await syncAll({
      db: env.DB, kv: env.SYNC_KV, client: bigClient(2500),
      now: () => "2026-07-01T12:00:00Z",
    });

    expect(result.hydrated).toBe(2500);
    const row = await env.DB.prepare(
      "SELECT count(*) n, sum(is_unread) unread, sum(is_starred) starred FROM entries",
    ).first<{ n: number; unread: number; starred: number }>();
    expect(row).toEqual({ n: 2500, unread: 2500, starred: 200 });
    expect(await env.SYNC_KV.get("last_sync")).toBe("2026-07-01T12:00:00Z");
  });
});
```

- [ ] **Step 2: テストが通ることを確認**（Foundation の修正が正しければ緑）

Run: `pnpm vitest run test/sync/sync.integration.test.ts`
Expected: PASS。もし FAIL するなら Foundation の `setFlagFromIds` チャンク化 or `upsertEntries` バッチに退行がある。

- [ ] **Step 3: コミット**

```bash
git add test/sync/sync.integration.test.ts
git commit -m "test: realistic-scale end-to-end sync integration test"
```

---

### Task 3: feed_state テーブルと last_surfaced 読み取り

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/db/queries.ts`
- Test: `test/db/feed-state.test.ts`

**Interfaces:**
- Consumes: `env.DB`
- Produces:
  - `SCHEMA_STATEMENTS` に `feed_state(feed_id INTEGER PRIMARY KEY, last_surfaced TEXT)` を追加
  - `getFeedLastSurfaced(db: D1Database): Promise<Map<number, string>>` — `last_surfaced` が非 null の feed のみ Map で返す

- [ ] **Step 1: 失敗するテストを書く**

```ts
// test/db/feed-state.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { initSchema, getFeedLastSurfaced } from "../../src/db/queries";

beforeEach(async () => {
  await initSchema(env.DB);
  await env.DB.exec("DELETE FROM feed_state");
});

describe("getFeedLastSurfaced", () => {
  it("returns a map of feed_id -> last_surfaced, skipping nulls", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO feed_state (feed_id, last_surfaced) VALUES (1, '2026-07-01T00:00:00Z')"),
      env.DB.prepare("INSERT INTO feed_state (feed_id, last_surfaced) VALUES (2, NULL)"),
    ]);
    const m = await getFeedLastSurfaced(env.DB);
    expect(m.get(1)).toBe("2026-07-01T00:00:00Z");
    expect(m.has(2)).toBe(false);
    expect(m.size).toBe(1);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm vitest run test/db/feed-state.test.ts`
Expected: FAIL（`no such table: feed_state` または `getFeedLastSurfaced is not a function`）

- [ ] **Step 3: スキーマに feed_state を追加**

`src/db/schema.ts` の `SCHEMA_STATEMENTS` 配列末尾に追加：

```ts
  `CREATE TABLE IF NOT EXISTS feed_state (
     feed_id INTEGER PRIMARY KEY,
     last_surfaced TEXT
   )`,
```

- [ ] **Step 4: クエリを実装**

`src/db/queries.ts` の末尾に追加：

```ts
export async function getFeedLastSurfaced(db: D1Database): Promise<Map<number, string>> {
  const { results } = await db.prepare(
    "SELECT feed_id, last_surfaced FROM feed_state WHERE last_surfaced IS NOT NULL",
  ).all<{ feed_id: number; last_surfaced: string }>();
  return new Map(results.map((r) => [r.feed_id, r.last_surfaced]));
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm vitest run test/db/feed-state.test.ts`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add src/db/schema.ts src/db/queries.ts test/db/feed-state.test.ts
git commit -m "feat(db): feed_state table and last_surfaced reader"
```

---

### Task 4: Tier 判定（純関数）

**Files:**
- Create: `src/selection/select.ts`
- Test: `test/selection/tier-map.test.ts`

**Interfaces:**
- Produces:
  - `interface SelectionEntry { id: number; feed_id: number; title: string | null; url: string | null; created_at: string | null }`
  - `buildFeedTierMap(taggings: { feed_id: number; name: string }[], coreTags: string[]): Map<number, 1 | 2>` — feed の tag のいずれかが coreTags に含まれれば 1、それ以外は 2。taggings に無い feed はこの Map に現れない（呼び出し側で既定 2 とする）。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// test/selection/tier-map.test.ts
import { describe, it, expect } from "vitest";
import { buildFeedTierMap } from "../../src/selection/select";

describe("buildFeedTierMap", () => {
  it("marks a feed Tier 1 when any of its tags is a core tag", () => {
    const m = buildFeedTierMap([
      { feed_id: 1, name: "Blog" },
      { feed_id: 1, name: "Must Read" }, // feed 1 is in both -> Tier 1 wins
      { feed_id: 2, name: "Blog" },
    ], ["Must Read"]);
    expect(m.get(1)).toBe(1);
    expect(m.get(2)).toBe(2);
  });

  it("omits feeds that have no taggings", () => {
    const m = buildFeedTierMap([{ feed_id: 1, name: "Blog" }], ["Must Read"]);
    expect(m.has(99)).toBe(false);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm vitest run test/selection/tier-map.test.ts`
Expected: FAIL（モジュール未作成）

- [ ] **Step 3: 実装**

```ts
// src/selection/select.ts
export interface SelectionEntry {
  id: number;
  feed_id: number;
  title: string | null;
  url: string | null;
  created_at: string | null;
}

export function buildFeedTierMap(
  taggings: { feed_id: number; name: string }[],
  coreTags: string[],
): Map<number, 1 | 2> {
  const core = new Set(coreTags);
  const map = new Map<number, 1 | 2>();
  for (const t of taggings) {
    const isCore = core.has(t.name);
    const current = map.get(t.feed_id);
    // Tier 1 wins if any tag is core; otherwise default to Tier 2.
    if (isCore) map.set(t.feed_id, 1);
    else if (current === undefined) map.set(t.feed_id, 2);
  }
  return map;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm vitest run test/selection/tier-map.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/selection/select.ts test/selection/tier-map.test.ts
git commit -m "feat(selection): feed tier assignment (core tags win)"
```

---

### Task 5: Tier 1 選別（純関数）

**Files:**
- Modify: `src/selection/select.ts`
- Test: `test/selection/tier1.test.ts`

**Interfaces:**
- Consumes: `SelectionEntry`, `buildFeedTierMap`
- Produces: `selectTier1(entries: SelectionEntry[], tierMap: Map<number, 1 | 2>): SelectionEntry[]` — Tier 1 の feed の entry 全件を `created_at` 降順（null は最後）。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// test/selection/tier1.test.ts
import { describe, it, expect } from "vitest";
import { selectTier1, type SelectionEntry } from "../../src/selection/select";

function e(id: number, feed: number, created: string | null): SelectionEntry {
  return { id, feed_id: feed, title: `t${id}`, url: null, created_at: created };
}

describe("selectTier1", () => {
  it("returns all Tier 1 entries newest-first", () => {
    const tierMap = new Map<number, 1 | 2>([[1, 1], [2, 2]]);
    const entries = [
      e(1, 1, "2026-07-01T00:00:00Z"),
      e(2, 2, "2026-07-03T00:00:00Z"), // Tier 2 -> excluded
      e(3, 1, "2026-07-02T00:00:00Z"),
    ];
    const out = selectTier1(entries, tierMap);
    expect(out.map((x) => x.id)).toEqual([3, 1]);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm vitest run test/selection/tier1.test.ts`
Expected: FAIL（`selectTier1` 未定義）

- [ ] **Step 3: 実装**

`src/selection/select.ts` に追加。ISO8601 は辞書順で時系列比較できる。null は最小（末尾）扱い。

```ts
function cmpCreatedDesc(a: SelectionEntry, b: SelectionEntry): number {
  const av = a.created_at ?? "";
  const bv = b.created_at ?? "";
  return av < bv ? 1 : av > bv ? -1 : 0;
}

export function selectTier1(
  entries: SelectionEntry[], tierMap: Map<number, 1 | 2>,
): SelectionEntry[] {
  return entries
    .filter((e) => tierMap.get(e.feed_id) === 1)
    .sort(cmpCreatedDesc);
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm vitest run test/selection/tier1.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/selection/select.ts test/selection/tier1.test.ts
git commit -m "feat(selection): tier 1 selection (all core, newest-first)"
```

---

### Task 6: Tier 2 選別 — アンチスタベーション×幅優先（純関数）

**Files:**
- Modify: `src/selection/select.ts`
- Test: `test/selection/tier2.test.ts`

**Interfaces:**
- Consumes: `SelectionEntry`, `cmpCreatedDesc`
- Produces:
  - `interface SelectionConfig { coreTags: string[]; tailBudget: number; perFeedCap: number }`
  - `selectTier2(entries: SelectionEntry[], tierMap: Map<number, 1 | 2>, lastSurfaced: Map<number, string>, cfg: SelectionConfig): SelectionEntry[]`
  - 手順: (1) Tier 2 の entry を feed でグルーピングし各 feed 内で `created_at` 降順、`perFeedCap` で切る。(2) feed を `last_surfaced` 昇順（未設定＝最優先）→ 同着は各 feed の最新 entry の `created_at` 降順で並べる。(3) 幅優先ラウンドロビン（pass 0,1,… で各 feed から1件ずつ）で `tailBudget` まで採る。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// test/selection/tier2.test.ts
import { describe, it, expect } from "vitest";
import { selectTier2, type SelectionEntry, type SelectionConfig } from "../../src/selection/select";

function e(id: number, feed: number, created: string): SelectionEntry {
  return { id, feed_id: feed, title: `t${id}`, url: null, created_at: created };
}
const CFG: SelectionConfig = { coreTags: ["Must Read"], tailBudget: 3, perFeedCap: 3 };
const allTier2 = new Map<number, 1 | 2>([[10, 2], [11, 2], [12, 2], [13, 2]]);

describe("selectTier2", () => {
  it("is breadth-first: one item per feed before a second from any feed", () => {
    // feed 10 has 3 items (all newest), others have 1 each
    const entries = [
      e(1, 10, "2026-07-01T09:00:00Z"), e(2, 10, "2026-07-01T08:00:00Z"), e(3, 10, "2026-07-01T07:00:00Z"),
      e(4, 11, "2026-07-01T06:00:00Z"),
      e(5, 12, "2026-07-01T05:00:00Z"),
    ];
    const out = selectTier2(entries, allTier2, new Map(), CFG);
    // budget 3, breadth-first: one from 10, one from 11, one from 12
    expect(out.map((x) => x.feed_id)).toEqual([10, 11, 12]);
  });

  it("prioritises feeds with the oldest last_surfaced (anti-starvation)", () => {
    const entries = [e(1, 10, "2026-07-01T09:00:00Z"), e(2, 11, "2026-07-01T08:00:00Z"), e(3, 12, "2026-07-01T07:00:00Z")];
    const lastSurfaced = new Map<number, string>([
      [10, "2026-07-01T00:00:00Z"], // surfaced most recently -> lowest priority
      [11, "2026-06-01T00:00:00Z"], // stale -> higher priority
      // feed 12 never surfaced -> highest priority
    ]);
    const cfg: SelectionConfig = { coreTags: ["Must Read"], tailBudget: 2, perFeedCap: 3 };
    const out = selectTier2(entries, allTier2, lastSurfaced, cfg);
    expect(out.map((x) => x.feed_id)).toEqual([12, 11]);
  });

  it("caps items per feed", () => {
    const entries = [
      e(1, 10, "2026-07-01T09:00:00Z"), e(2, 10, "2026-07-01T08:00:00Z"),
      e(3, 10, "2026-07-01T07:00:00Z"), e(4, 10, "2026-07-01T06:00:00Z"),
    ];
    const cfg: SelectionConfig = { coreTags: ["Must Read"], tailBudget: 10, perFeedCap: 2 };
    const out = selectTier2(entries, allTier2, new Map(), cfg);
    expect(out.map((x) => x.id)).toEqual([1, 2]); // only 2 from the single feed
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm vitest run test/selection/tier2.test.ts`
Expected: FAIL（`selectTier2` 未定義）

- [ ] **Step 3: 実装**

`src/selection/select.ts` に追加：

```ts
export interface SelectionConfig {
  coreTags: string[];
  tailBudget: number;
  perFeedCap: number;
}

export function selectTier2(
  entries: SelectionEntry[],
  tierMap: Map<number, 1 | 2>,
  lastSurfaced: Map<number, string>,
  cfg: SelectionConfig,
): SelectionEntry[] {
  // (1) group Tier 2 entries by feed; newest-first; cap per feed
  const byFeed = new Map<number, SelectionEntry[]>();
  for (const e of entries) {
    if ((tierMap.get(e.feed_id) ?? 2) !== 2) continue;
    const list = byFeed.get(e.feed_id);
    if (list) list.push(e);
    else byFeed.set(e.feed_id, [e]);
  }
  for (const [feed, list] of byFeed) {
    list.sort(cmpCreatedDesc);
    byFeed.set(feed, list.slice(0, cfg.perFeedCap));
  }

  // (2) order feeds: oldest last_surfaced first (never-surfaced first),
  //     tie-break by freshest item desc
  const feeds = [...byFeed.keys()].sort((a, b) => {
    const la = lastSurfaced.get(a);
    const lb = lastSurfaced.get(b);
    if (la !== lb) {
      if (la === undefined) return -1;
      if (lb === undefined) return 1;
      return la < lb ? -1 : 1;
    }
    return cmpCreatedDesc(byFeed.get(a)![0]!, byFeed.get(b)![0]!);
  });

  // (3) breadth-first round-robin until budget
  const out: SelectionEntry[] = [];
  let pass = 0;
  while (out.length < cfg.tailBudget && feeds.some((f) => byFeed.get(f)!.length > pass)) {
    for (const f of feeds) {
      const items = byFeed.get(f)!;
      if (pass < items.length) {
        out.push(items[pass]!);
        if (out.length >= cfg.tailBudget) break;
      }
    }
    pass++;
  }
  return out;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm vitest run test/selection/tier2.test.ts`
Expected: PASS（3 ケース）

- [ ] **Step 5: コミット**

```bash
git add src/selection/select.ts test/selection/tier2.test.ts
git commit -m "feat(selection): tier 2 anti-starvation breadth-first sampling"
```

---

### Task 7: buildSelection オーケストレータ + 選別用 D1 リード

**Files:**
- Modify: `src/selection/select.ts`
- Modify: `src/db/queries.ts`
- Test: `test/selection/build.test.ts`

**Interfaces:**
- Consumes: `buildFeedTierMap`, `selectTier1`, `selectTier2`, `SelectionEntry`, `SelectionConfig`
- Produces:
  - `interface Selection { tier1: SelectionEntry[]; tier2: SelectionEntry[] }`
  - `DEFAULT_SELECTION_CONFIG: SelectionConfig`（`{ coreTags: ["Must Read"], tailBudget: 30, perFeedCap: 3 }`）
  - `buildSelection(entries, taggings, lastSurfaced, cfg): Selection`（純関数）
  - `getUnreadForSelection(db: D1Database): Promise<SelectionEntry[]>` — `SELECT id, feed_id, title, url, created_at FROM entries WHERE is_unread=1`
  - `getAllTaggings(db: D1Database): Promise<{ feed_id: number; name: string }[]>`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// test/selection/build.test.ts
import { describe, it, expect } from "vitest";
import { buildSelection, DEFAULT_SELECTION_CONFIG, type SelectionEntry } from "../../src/selection/select";

function e(id: number, feed: number, created: string): SelectionEntry {
  return { id, feed_id: feed, title: `t${id}`, url: null, created_at: created };
}

describe("buildSelection", () => {
  it("splits entries into tier1 (core) and tier2 (sampled tail)", () => {
    const entries = [
      e(1, 1, "2026-07-01T09:00:00Z"),  // feed 1 = Must Read -> tier1
      e(2, 2, "2026-07-01T08:00:00Z"),  // feed 2 = Blog -> tier2
      e(3, 3, "2026-07-01T07:00:00Z"),  // feed 3 = untagged -> tier2
    ];
    const taggings = [
      { feed_id: 1, name: "Must Read" },
      { feed_id: 2, name: "Blog" },
    ];
    const sel = buildSelection(entries, taggings, new Map(), DEFAULT_SELECTION_CONFIG);
    expect(sel.tier1.map((x) => x.id)).toEqual([1]);
    expect(sel.tier2.map((x) => x.id).sort()).toEqual([2, 3]);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm vitest run test/selection/build.test.ts`
Expected: FAIL（`buildSelection` 未定義）

- [ ] **Step 3: buildSelection を実装**

`src/selection/select.ts` に追加：

```ts
export interface Selection {
  tier1: SelectionEntry[];
  tier2: SelectionEntry[];
}

export const DEFAULT_SELECTION_CONFIG: SelectionConfig = {
  coreTags: ["Must Read"],
  tailBudget: 30,
  perFeedCap: 3,
};

export function buildSelection(
  entries: SelectionEntry[],
  taggings: { feed_id: number; name: string }[],
  lastSurfaced: Map<number, string>,
  cfg: SelectionConfig,
): Selection {
  const tierMap = buildFeedTierMap(taggings, cfg.coreTags);
  return {
    tier1: selectTier1(entries, tierMap),
    tier2: selectTier2(entries, tierMap, lastSurfaced, cfg),
  };
}
```

- [ ] **Step 4: 選別用の D1 リードを実装**

`src/db/queries.ts` に追加：

```ts
export async function getUnreadForSelection(
  db: D1Database,
): Promise<{ id: number; feed_id: number; title: string | null; url: string | null; created_at: string | null }[]> {
  const { results } = await db.prepare(
    "SELECT id, feed_id, title, url, created_at FROM entries WHERE is_unread = 1",
  ).all<{ id: number; feed_id: number; title: string | null; url: string | null; created_at: string | null }>();
  return results;
}

export async function getAllTaggings(
  db: D1Database,
): Promise<{ feed_id: number; name: string }[]> {
  const { results } = await db.prepare(
    "SELECT feed_id, name FROM taggings",
  ).all<{ feed_id: number; name: string }>();
  return results;
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm vitest run test/selection/build.test.ts`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add src/selection/select.ts src/db/queries.ts test/selection/build.test.ts
git commit -m "feat(selection): buildSelection orchestrator and D1 readers"
```

---

### Task 8: GET /feed 配信エンドポイント（実データ目視の窓）

**Files:**
- Modify: `src/index.ts`
- Test: `test/feed-endpoint.test.ts`

**Interfaces:**
- Consumes: `getUnreadForSelection`, `getAllTaggings`, `getFeedLastSurfaced`, `buildSelection`, `DEFAULT_SELECTION_CONFIG`
- Produces: `GET /feed` → `{ tier1: SelectionEntry[]; tier2: SelectionEntry[] }` を JSON 返却。D1 の現在状態から選別を組み立てる。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// test/feed-endpoint.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import worker from "../src/index";
import { initSchema } from "../src/db/queries";

beforeEach(async () => {
  await initSchema(env.DB);
  await env.DB.exec("DELETE FROM entries");
  await env.DB.exec("DELETE FROM taggings");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO taggings (id, feed_id, name) VALUES (1, 1, 'Must Read')"),
    env.DB.prepare("INSERT INTO taggings (id, feed_id, name) VALUES (2, 2, 'Blog')"),
    env.DB.prepare("INSERT INTO entries (id, feed_id, title, url, created_at, is_unread, synced_at) VALUES (1, 1, 'core', null, '2026-07-01T09:00:00Z', 1, 't')"),
    env.DB.prepare("INSERT INTO entries (id, feed_id, title, url, created_at, is_unread, synced_at) VALUES (2, 2, 'tail', null, '2026-07-01T08:00:00Z', 1, 't')"),
  ]);
});

describe("GET /feed", () => {
  it("returns tier1 and tier2 from the D1 mirror", async () => {
    const res = await worker.fetch(
      new Request("https://buta.example/feed"),
      env as never, {} as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { tier1: { id: number }[]; tier2: { id: number }[] };
    expect(body.tier1.map((x) => x.id)).toEqual([1]);
    expect(body.tier2.map((x) => x.id)).toEqual([2]);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm vitest run test/feed-endpoint.test.ts`
Expected: FAIL（`/feed` は現状 404）

- [ ] **Step 3: 実装**

`src/index.ts` の import に選別関連を追加：

```ts
import {
  initSchema, getUnreadForSelection, getAllTaggings, getFeedLastSurfaced,
} from "./db/queries";
import { buildSelection, DEFAULT_SELECTION_CONFIG } from "./selection/select";
```

`fetch` のルーティングに追加（`/health` の直後あたり）：

```ts
    if (request.method === "GET" && url.pathname === "/feed") {
      const [entries, taggings, lastSurfaced] = await Promise.all([
        getUnreadForSelection(env.DB),
        getAllTaggings(env.DB),
        getFeedLastSurfaced(env.DB),
      ]);
      const selection = buildSelection(entries, taggings, lastSurfaced, DEFAULT_SELECTION_CONFIG);
      return Response.json(selection);
    }
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm vitest run test/feed-endpoint.test.ts`
Expected: PASS

- [ ] **Step 5: 全テスト + 型チェック**

Run: `pnpm test && pnpm typecheck`
Expected: 全て PASS

- [ ] **Step 6: コミット**

```bash
git add src/index.ts test/feed-endpoint.test.ts
git commit -m "feat: GET /feed serves the two-tier selection from the mirror"
```

---

### Task 9: 実データで選別出力を目視（手動）

自動テストではなく、実 Feedbin データに対する選別の当たり確認。実行者の操作が要る。

- [ ] **Step 1: ADMIN_TOKEN を登録してデプロイ**

```bash
pnpm wrangler secret put ADMIN_TOKEN   # 任意の長い文字列
pnpm deploy
```

- [ ] **Step 2: オンデマンド同期でミラーを最新化**

```bash
curl -X POST https://buta.yuta25.workers.dev/admin/sync \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```
Expected: `{"hydrated":...,"unread":...,"starred":...}`

- [ ] **Step 3: 選別出力を取得して目視**

```bash
curl -s https://buta.yuta25.workers.dev/feed | \
  python3 -c "import sys,json; d=json.load(sys.stdin); \
  print('tier1', len(d['tier1'])); [print(' ', e['title']) for e in d['tier1'][:10]]; \
  print('tier2', len(d['tier2']), 'feeds', len({e['feed_id'] for e in d['tier2']})); \
  [print(' ', e['feed_id'], e['title']) for e in d['tier2']]"
```
Expected: tier1 が Must Read の未読、tier2 が 30 件・~30 フィードにまたがる。スパイクと同じ「幅の広い代表」が出ることを確認。

- [ ] **Step 4: 判断**

出力が「時系列より捌きやすい」感触なら plan 3（ビュー報告＝既読/スター書き戻し + `last_surfaced` 更新）へ。定数（tailBudget/perFeedCap/coreTags）を変えたければ `DEFAULT_SELECTION_CONFIG` を編集して再デプロイし、`/feed` を再取得して比較（オンデマンド同期のおかげで秒で回る）。

---

## Self-Review

**1. Spec coverage（DESIGN.md 選別セクション）:**
- 二層（Tier 1=Must Read 全件 / Tier 2=尾） → Task 5/6/7 ✓
- 複数フォルダ時は core 優先 → Task 4（Tier 1 wins）✓
- 幅優先 1/feed + perFeedCap バースト → Task 6 ✓
- アンチスタベーション（last_surfaced 昇順、未設定最優先） → Task 6 + Task 3 ✓
- 2 状態のみ、last_surfaced はこの plan では読むだけ → Task 3（更新は plan 3）✓
- 実データ目視の窓（GET /feed）→ Task 8/9 ✓
- デバッグ足回り（オンデマンド同期 + 現実スケール統合テスト）→ Task 1/2 ✓
- **この plan の非対象**: ビュー報告＝既読/スター書き戻し + last_surfaced 更新（plan 3）、exact-match dedup（plan 3 か本 plan の追補、主敵でないので後回し）、PWA（plan 4）。

**2. Placeholder scan:** 各ステップに実コードあり。曖昧指示なし。

**3. Type consistency:** `SelectionEntry`（id/feed_id/title/url/created_at）は D1 リード・純関数・エンドポイントで一致。`SelectionConfig`（coreTags/tailBudget/perFeedCap）と `Selection`（tier1/tier2）はテストの期待と一致。`buildFeedTierMap`→`selectTier1`/`selectTier2`→`buildSelection` の呼び出し名・引数順は Task 4-7 で整合。`getFeedLastSurfaced`/`getUnreadForSelection`/`getAllTaggings` は Task 3/7 で定義し Task 8 で消費。

---

## 未解決（この plan の範囲外・次 plan で扱う）

- **ビュー報告の書き戻し**（plan 3）: クライアントが「スクロール通過した entry」を報告 → Feedbin `DELETE unread_entries` で既読化 + 当該 feed の `feed_state.last_surfaced` を更新。これが無いと `/feed` は毎回同じ（回転しない）ので、plan 3 まではオンデマンド同期 + 定数変更で目視評価する。
- **exact-match dedup**（plan 3 で選別前段に挿入）。
- **未読プール肥大への差分同期・retention**（Foundation の全走査リセット置換）。
