# buta ビュー報告・書き戻し (View Reporting) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to実装 this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** クライアントが「スクロール通過した entry」を報告する `POST /viewed` と、スター切替 `POST /star` を実装する。既読/スターは **Feedbin に先に書き**（真実の源）、成功後に D1 ミラーへ反映し、通過 entry の feed の `feed_state.last_surfaced` を前進させる。これでアンチスタベーションの回転が始まる。

**Architecture:** FeedbinClient に書き込みメソッド（1000 id/リクエストでチャンク）を追加。D1 側は既存パターン（90 変数/文で `db.batch`）の書き込みヘルパー。エンドポイントは既存の bare fetch ルーティング＋`isAuthorized` ゲート。**書き込み順序は Feedbin → D1**（Feedbin が失敗したらローカルを触らず 502。D1 反映は次回同期でも自己修復するベストエフォート）。

**Tech Stack:** 既存スタック（TypeScript strict / Workers / D1 / vitest workers pool / pnpm）。Plan 2 の成果（33 テスト緑）の上に載る。

## Global Constraints

- Feedbin 書き込み: `DELETE /v2/unread_entries.json` body `{"unread_entries":[ids]}`、`POST /v2/starred_entries.json` / `DELETE /v2/starred_entries.json` body `{"starred_entries":[ids]}`。**1 リクエスト最大 1000 id**。レスポンスは成功した id の配列。
- D1 の IN 句は **90 変数/文でチャンクし `db.batch`**。
- `/viewed` と `/star` は `isAuthorized`（既存の定数時間比較・fail-closed）でゲート。
- **順序: Feedbin 書き込み成功 → D1 反映**。Feedbin 失敗時は 502 を返しローカル無変更。
- `last_surfaced` は ISO8601 文字列。呼び出し側が `now()` を注入（テスト決定性）。
- テストはネットワークに出ない。コミットはタスクごと。TDD。

---

### Task 1: FeedbinClient 書き込みメソッド（既読化・スター・解除）

**Files:**
- Modify: `src/feedbin/client.ts`
- Test: `test/feedbin/client.write.test.ts`

**Interfaces:**
- Produces:
  - `markEntriesRead(ids: number[]): Promise<number[]>` — DELETE unread_entries、1000/チャンク、確認済み id を結合して返す。空なら fetch せず `[]`。
  - `starEntries(ids: number[]): Promise<number[]>` — POST starred_entries、同様。
  - `unstarEntries(ids: number[]): Promise<number[]>` — DELETE starred_entries、同様。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// test/feedbin/client.write.test.ts
import { describe, it, expect, vi } from "vitest";
import { FeedbinClient } from "../../src/feedbin/client";

function echoFetch() {
  // Echoes back the ids sent in the body, like Feedbin does on success.
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, number[]>;
    const ids = Object.values(body)[0]!;
    return new Response(JSON.stringify(ids), {
      status: 200, headers: { "content-type": "application/json" },
    });
  });
}

function client(fetchFn: typeof fetch) {
  return new FeedbinClient({ credentials: { email: "a@b.com", password: "pw" }, fetchFn });
}

describe("FeedbinClient write endpoints", () => {
  it("markEntriesRead DELETEs unread_entries and returns confirmed ids", async () => {
    const fetchFn = echoFetch();
    const out = await client(fetchFn as unknown as typeof fetch).markEntriesRead([1, 2, 3]);
    expect(out).toEqual([1, 2, 3]);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://api.feedbin.com/v2/unread_entries.json");
    expect(init!.method).toBe("DELETE");
    expect(JSON.parse(String(init!.body))).toEqual({ unread_entries: [1, 2, 3] });
  });

  it("chunks writes at 1000 ids per request", async () => {
    const fetchFn = echoFetch();
    const ids = Array.from({ length: 1500 }, (_, i) => i + 1);
    const out = await client(fetchFn as unknown as typeof fetch).markEntriesRead(ids);
    expect(out).toHaveLength(1500);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const first = JSON.parse(String(fetchFn.mock.calls[0]![1]!.body)) as { unread_entries: number[] };
    expect(first.unread_entries).toHaveLength(1000);
  });

  it("returns [] without fetching when ids is empty", async () => {
    const fetchFn = vi.fn();
    const out = await client(fetchFn as unknown as typeof fetch).markEntriesRead([]);
    expect(out).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("starEntries POSTs and unstarEntries DELETEs starred_entries", async () => {
    const f1 = echoFetch();
    await client(f1 as unknown as typeof fetch).starEntries([7]);
    expect(f1.mock.calls[0]![0]).toBe("https://api.feedbin.com/v2/starred_entries.json");
    expect(f1.mock.calls[0]![1]!.method).toBe("POST");

    const f2 = echoFetch();
    await client(f2 as unknown as typeof fetch).unstarEntries([7]);
    expect(f2.mock.calls[0]![1]!.method).toBe("DELETE");
    expect(JSON.parse(String(f2.mock.calls[0]![1]!.body))).toEqual({ starred_entries: [7] });
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm vitest run test/feedbin/client.write.test.ts`
Expected: FAIL（`markEntriesRead is not a function`）

- [ ] **Step 3: 実装**

`src/feedbin/client.ts` のクラス末尾（`getEntriesByIds` の後）に追加：

```ts
  private async writeIds(
    method: "POST" | "DELETE", path: string, key: string, ids: number[],
  ): Promise<number[]> {
    const out: number[] = [];
    for (let i = 0; i < ids.length; i += 1000) {
      const chunk = ids.slice(i, i + 1000);
      const res = await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        headers: { Authorization: this.authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: chunk }),
      });
      if (!res.ok) {
        throw new Error(`Feedbin ${method} ${path} failed: ${res.status}`);
      }
      out.push(...((await res.json()) as number[]));
    }
    return out;
  }

  async markEntriesRead(ids: number[]): Promise<number[]> {
    return this.writeIds("DELETE", "/unread_entries.json", "unread_entries", ids);
  }

  async starEntries(ids: number[]): Promise<number[]> {
    return this.writeIds("POST", "/starred_entries.json", "starred_entries", ids);
  }

  async unstarEntries(ids: number[]): Promise<number[]> {
    return this.writeIds("DELETE", "/starred_entries.json", "starred_entries", ids);
  }
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm vitest run test/feedbin/client.write.test.ts`
Expected: PASS（4 ケース）

- [ ] **Step 5: コミット**

```bash
git add src/feedbin/client.ts test/feedbin/client.write.test.ts
git commit -m "feat(feedbin): write methods for read/star state (chunked at 1000)"
```

---

### Task 2: D1 書き込みヘルパー（ローカル既読・スター・last_surfaced）

**Files:**
- Modify: `src/db/queries.ts`
- Test: `test/db/write-back.test.ts`

**Interfaces:**
- Produces:
  - `markEntriesReadLocal(db: D1Database, ids: number[]): Promise<void>` — `is_unread=0`、90/チャンクで batch。
  - `setEntriesStarredLocal(db: D1Database, ids: number[], starred: boolean): Promise<void>`
  - `getFeedIdsForEntries(db: D1Database, ids: number[]): Promise<Set<number>>` — 指定 entry の feed_id 集合。90/チャンク。
  - `touchFeedLastSurfaced(db: D1Database, feedIds: number[], when: string): Promise<void>` — feed_state に upsert（`ON CONFLICT(feed_id) DO UPDATE`）。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// test/db/write-back.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import {
  initSchema, upsertEntries, markEntriesReadLocal, setEntriesStarredLocal,
  getFeedIdsForEntries, touchFeedLastSurfaced, getFeedLastSurfaced,
} from "../../src/db/queries";
import type { FeedbinEntry } from "../../src/feedbin/types";

function entry(id: number, feed: number): FeedbinEntry {
  return {
    id, feed_id: feed, title: `t${id}`, url: null, author: null,
    summary: null, content: null, published: null, created_at: "2026-07-01T00:00:00Z",
  };
}

beforeEach(async () => {
  await initSchema(env.DB);
  await env.DB.exec("DELETE FROM entries");
  await env.DB.exec("DELETE FROM feed_state");
});

describe("write-back helpers", () => {
  it("markEntriesReadLocal clears is_unread for listed ids only, even 200+ ids", async () => {
    const ids = Array.from({ length: 200 }, (_, i) => i + 1);
    await upsertEntries(env.DB, ids.map((i) => entry(i, 1)), "t");
    await env.DB.prepare("UPDATE entries SET is_unread = 1").run();
    await markEntriesReadLocal(env.DB, ids.slice(0, 150));
    const row = await env.DB.prepare(
      "SELECT sum(is_unread) unread FROM entries",
    ).first<{ unread: number }>();
    expect(row?.unread).toBe(50);
  });

  it("setEntriesStarredLocal sets and clears the flag", async () => {
    await upsertEntries(env.DB, [entry(1, 1)], "t");
    await setEntriesStarredLocal(env.DB, [1], true);
    let row = await env.DB.prepare("SELECT is_starred FROM entries WHERE id=1").first<{ is_starred: number }>();
    expect(row?.is_starred).toBe(1);
    await setEntriesStarredLocal(env.DB, [1], false);
    row = await env.DB.prepare("SELECT is_starred FROM entries WHERE id=1").first<{ is_starred: number }>();
    expect(row?.is_starred).toBe(0);
  });

  it("getFeedIdsForEntries returns the distinct feed set", async () => {
    await upsertEntries(env.DB, [entry(1, 10), entry(2, 10), entry(3, 20)], "t");
    const feeds = await getFeedIdsForEntries(env.DB, [1, 2, 3]);
    expect([...feeds].sort()).toEqual([10, 20]);
  });

  it("touchFeedLastSurfaced upserts and getFeedLastSurfaced reads it back", async () => {
    await touchFeedLastSurfaced(env.DB, [10], "2026-07-02T00:00:00Z");
    await touchFeedLastSurfaced(env.DB, [10, 20], "2026-07-02T01:00:00Z");
    const m = await getFeedLastSurfaced(env.DB);
    expect(m.get(10)).toBe("2026-07-02T01:00:00Z"); // updated, not duplicated
    expect(m.get(20)).toBe("2026-07-02T01:00:00Z");
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm vitest run test/db/write-back.test.ts`
Expected: FAIL（各関数未定義）

- [ ] **Step 3: 実装**

`src/db/queries.ts` 末尾に追加（チャンク定数は既存 `FLAG_ID_CHUNK` を再利用）：

```ts
function chunkIds(ids: number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < ids.length; i += FLAG_ID_CHUNK) out.push(ids.slice(i, i + FLAG_ID_CHUNK));
  return out;
}

export async function markEntriesReadLocal(db: D1Database, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await db.batch(chunkIds(ids).map((chunk) =>
    db.prepare(
      `UPDATE entries SET is_unread = 0 WHERE id IN (${chunk.map(() => "?").join(",")})`,
    ).bind(...chunk),
  ));
}

export async function setEntriesStarredLocal(
  db: D1Database, ids: number[], starred: boolean,
): Promise<void> {
  if (ids.length === 0) return;
  const v = starred ? 1 : 0;
  await db.batch(chunkIds(ids).map((chunk) =>
    db.prepare(
      `UPDATE entries SET is_starred = ${v} WHERE id IN (${chunk.map(() => "?").join(",")})`,
    ).bind(...chunk),
  ));
}

export async function getFeedIdsForEntries(
  db: D1Database, ids: number[],
): Promise<Set<number>> {
  const feeds = new Set<number>();
  for (const chunk of chunkIds(ids)) {
    const { results } = await db.prepare(
      `SELECT DISTINCT feed_id FROM entries WHERE id IN (${chunk.map(() => "?").join(",")})`,
    ).bind(...chunk).all<{ feed_id: number }>();
    for (const r of results) feeds.add(r.feed_id);
  }
  return feeds;
}

export async function touchFeedLastSurfaced(
  db: D1Database, feedIds: number[], when: string,
): Promise<void> {
  if (feedIds.length === 0) return;
  const stmt = db.prepare(
    `INSERT INTO feed_state (feed_id, last_surfaced) VALUES (?, ?)
     ON CONFLICT(feed_id) DO UPDATE SET last_surfaced = excluded.last_surfaced`,
  );
  await db.batch(feedIds.map((f) => stmt.bind(f, when)));
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm vitest run test/db/write-back.test.ts`
Expected: PASS（4 ケース）

- [ ] **Step 5: コミット**

```bash
git add src/db/queries.ts test/db/write-back.test.ts
git commit -m "feat(db): local read/star write-back and last_surfaced upsert"
```

---

### Task 3: POST /viewed エンドポイント

**Files:**
- Modify: `src/index.ts`
- Test: `test/viewed-endpoint.test.ts`

**Interfaces:**
- Consumes: `isAuthorized`, Task 1 の `markEntriesRead`, Task 2 のヘルパー
- Produces: `POST /viewed`（auth 必須）body `{ "entryIds": number[] }` →
  1. Feedbin `markEntriesRead(entryIds)`（失敗なら 502、ローカル無変更）
  2. `markEntriesReadLocal`
  3. `getFeedIdsForEntries` → `touchFeedLastSurfaced(feeds, now)`
  4. `{ read: <確認済み件数>, feedsTouched: <feed数> }` を返す
- 不正 body（entryIds が配列でない/数値以外を含む）は 400。空配列は何もせず `{ read: 0, feedsTouched: 0 }`。
- テストから Feedbin をスタブできるよう、`runSync` と同様に **client ファクトリを分離**する：`makeFeedbinClient(env)` を作り、`fetch` ハンドラはそれを使う。テストでは `worker` を直接 fetch し、`globalThis.fetch` を `vi.stubGlobal` してFeedbin 呼び出しを偽装（native 経路も踏めて一石二鳥）。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// test/viewed-endpoint.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { env } from "cloudflare:test";
import worker from "../src/index";
import { initSchema, getFeedLastSurfaced } from "../src/db/queries";

const AUTH = { Authorization: "Bearer test-token", "Content-Type": "application/json" };

beforeEach(async () => {
  await initSchema(env.DB);
  await env.DB.exec("DELETE FROM entries");
  await env.DB.exec("DELETE FROM feed_state");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO entries (id, feed_id, title, url, created_at, is_unread, synced_at) VALUES (1, 10, 'a', null, 't', 1, 't')"),
    env.DB.prepare("INSERT INTO entries (id, feed_id, title, url, created_at, is_unread, synced_at) VALUES (2, 20, 'b', null, 't', 1, 't')"),
  ]);
});
afterEach(() => vi.unstubAllGlobals());

function stubFeedbin(status = 200) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url: String(url), method: init?.method ?? "GET", body });
    const ids = body ? (Object.values(body)[0] as number[]) : [];
    return new Response(status === 200 ? JSON.stringify(ids) : null, { status });
  });
  return calls;
}

function post(body: unknown) {
  return worker.fetch(
    new Request("https://buta.example/viewed", {
      method: "POST", headers: AUTH, body: JSON.stringify(body),
    }),
    env as never, {} as never,
  );
}

describe("POST /viewed", () => {
  it("401 without token", async () => {
    const res = await worker.fetch(
      new Request("https://buta.example/viewed", { method: "POST", body: "{}" }),
      env as never, {} as never,
    );
    expect(res.status).toBe(401);
  });

  it("marks read in Feedbin then locally, and touches last_surfaced", async () => {
    const calls = stubFeedbin();
    const res = await post({ entryIds: [1, 2] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ read: 2, feedsTouched: 2 });

    // Feedbin call happened
    expect(calls[0]!.url).toContain("/unread_entries.json");
    expect(calls[0]!.method).toBe("DELETE");

    // local mirror updated
    const row = await env.DB.prepare("SELECT sum(is_unread) u FROM entries").first<{ u: number }>();
    expect(row?.u).toBe(0);

    // last_surfaced advanced for both feeds
    const m = await getFeedLastSurfaced(env.DB);
    expect(m.has(10)).toBe(true);
    expect(m.has(20)).toBe(true);
  });

  it("returns 502 and leaves local state untouched when Feedbin fails", async () => {
    stubFeedbin(500);
    const res = await post({ entryIds: [1] });
    expect(res.status).toBe(502);
    const row = await env.DB.prepare("SELECT is_unread FROM entries WHERE id=1").first<{ is_unread: number }>();
    expect(row?.is_unread).toBe(1);
    expect((await getFeedLastSurfaced(env.DB)).size).toBe(0);
  });

  it("400 on malformed body", async () => {
    const res = await post({ entryIds: "nope" });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm vitest run test/viewed-endpoint.test.ts`
Expected: FAIL（`/viewed` は 404）

- [ ] **Step 3: 実装**

`src/index.ts` の import を拡張：

```ts
import {
  initSchema, getUnreadForSelection, getAllTaggings, getFeedLastSurfaced,
  markEntriesReadLocal, getFeedIdsForEntries, touchFeedLastSurfaced,
} from "./db/queries";
```

client ファクトリを抽出（`runSync` の直前）し、`runSync` 内の生成をこれに置換：

```ts
function makeFeedbinClient(env: Env): FeedbinClient {
  return new FeedbinClient({
    credentials: { email: env.FEEDBIN_EMAIL, password: env.FEEDBIN_PASSWORD },
  });
}
```

`fetch` ルーティングに `/viewed` を追加（`/admin/sync` の後）：

```ts
    if (request.method === "POST" && url.pathname === "/viewed") {
      if (!isAuthorized(request, env.ADMIN_TOKEN)) {
        return new Response("Unauthorized", { status: 401 });
      }
      const body = (await request.json().catch(() => null)) as { entryIds?: unknown } | null;
      const entryIds = body?.entryIds;
      if (!Array.isArray(entryIds) || entryIds.some((x) => typeof x !== "number")) {
        return new Response("Bad Request", { status: 400 });
      }
      if (entryIds.length === 0) {
        return Response.json({ read: 0, feedsTouched: 0 });
      }

      let confirmed: number[];
      try {
        confirmed = await makeFeedbinClient(env).markEntriesRead(entryIds as number[]);
      } catch {
        return new Response("Feedbin write failed", { status: 502 });
      }

      await markEntriesReadLocal(env.DB, confirmed);
      const feeds = await getFeedIdsForEntries(env.DB, confirmed);
      await touchFeedLastSurfaced(env.DB, [...feeds], new Date().toISOString());
      return Response.json({ read: confirmed.length, feedsTouched: feeds.size });
    }
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm vitest run test/viewed-endpoint.test.ts`
Expected: PASS（4 ケース）

- [ ] **Step 5: 全テスト + 型チェック + コミット**

Run: `pnpm test && pnpm typecheck`
Expected: 全て PASS

```bash
git add src/index.ts test/viewed-endpoint.test.ts
git commit -m "feat: POST /viewed marks read in Feedbin and advances last_surfaced"
```

---

### Task 4: POST /star エンドポイント（スター切替）

**Files:**
- Modify: `src/index.ts`
- Test: `test/star-endpoint.test.ts`

**Interfaces:**
- Produces: `POST /star`（auth 必須）body `{ "entryIds": number[], "starred": boolean }` → Feedbin `starEntries`/`unstarEntries` → 成功後 `setEntriesStarredLocal` → `{ updated: number }`。失敗時 502、無変更。バリデーションは `/viewed` と同様（`starred` が boolean でなければ 400）。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// test/star-endpoint.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { env } from "cloudflare:test";
import worker from "../src/index";
import { initSchema } from "../src/db/queries";

const AUTH = { Authorization: "Bearer test-token", "Content-Type": "application/json" };

beforeEach(async () => {
  await initSchema(env.DB);
  await env.DB.exec("DELETE FROM entries");
  await env.DB.prepare(
    "INSERT INTO entries (id, feed_id, title, url, created_at, is_unread, synced_at) VALUES (1, 10, 'a', null, 't', 1, 't')",
  ).run();
});
afterEach(() => vi.unstubAllGlobals());

function stubFeedbin() {
  const calls: { url: string; method: string }[] = [];
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET" });
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    return new Response(JSON.stringify(Object.values(body)[0] ?? []), { status: 200 });
  });
  return calls;
}

function post(body: unknown) {
  return worker.fetch(
    new Request("https://buta.example/star", {
      method: "POST", headers: AUTH, body: JSON.stringify(body),
    }),
    env as never, {} as never,
  );
}

describe("POST /star", () => {
  it("stars via Feedbin POST and updates the mirror", async () => {
    const calls = stubFeedbin();
    const res = await post({ entryIds: [1], starred: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 1 });
    expect(calls[0]!.url).toContain("/starred_entries.json");
    expect(calls[0]!.method).toBe("POST");
    const row = await env.DB.prepare("SELECT is_starred FROM entries WHERE id=1").first<{ is_starred: number }>();
    expect(row?.is_starred).toBe(1);
  });

  it("unstars via Feedbin DELETE", async () => {
    const calls = stubFeedbin();
    await env.DB.prepare("UPDATE entries SET is_starred = 1 WHERE id = 1").run();
    const res = await post({ entryIds: [1], starred: false });
    expect(res.status).toBe(200);
    expect(calls[0]!.method).toBe("DELETE");
    const row = await env.DB.prepare("SELECT is_starred FROM entries WHERE id=1").first<{ is_starred: number }>();
    expect(row?.is_starred).toBe(0);
  });

  it("400 when starred is not boolean", async () => {
    const res = await post({ entryIds: [1], starred: "yes" });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm vitest run test/star-endpoint.test.ts`
Expected: FAIL（`/star` は 404）

- [ ] **Step 3: 実装**

import に `setEntriesStarredLocal` を追加し、ルーティングに追加：

```ts
    if (request.method === "POST" && url.pathname === "/star") {
      if (!isAuthorized(request, env.ADMIN_TOKEN)) {
        return new Response("Unauthorized", { status: 401 });
      }
      const body = (await request.json().catch(() => null)) as
        { entryIds?: unknown; starred?: unknown } | null;
      const entryIds = body?.entryIds;
      const starred = body?.starred;
      if (!Array.isArray(entryIds) || entryIds.some((x) => typeof x !== "number")
        || typeof starred !== "boolean") {
        return new Response("Bad Request", { status: 400 });
      }
      if (entryIds.length === 0) return Response.json({ updated: 0 });

      let confirmed: number[];
      try {
        const client = makeFeedbinClient(env);
        confirmed = starred
          ? await client.starEntries(entryIds as number[])
          : await client.unstarEntries(entryIds as number[]);
      } catch {
        return new Response("Feedbin write failed", { status: 502 });
      }

      await setEntriesStarredLocal(env.DB, confirmed, starred);
      return Response.json({ updated: confirmed.length });
    }
```

- [ ] **Step 4: 全テスト + 型チェック + コミット**

Run: `pnpm test && pnpm typecheck`
Expected: 全て PASS

```bash
git add src/index.ts test/star-endpoint.test.ts
git commit -m "feat: POST /star toggles star state via Feedbin and mirror"
```

---

### Task 5: 実データで回転を確認（手動）

アンチスタベーションが実際に回るかの確認。実行者の操作が要る。

- [ ] **Step 1: デプロイ**

```bash
pnpm deploy
```

- [ ] **Step 2: /feed を取得し、tier2 の entry id と feed_id を控える**

```bash
curl -sS -H "Authorization: Bearer <ADMIN_TOKEN>" https://buta.yuta25.workers.dev/feed \
  | python3 -c "import sys,json; d=json.load(sys.stdin); [print(e['id'], e['feed_id']) for e in d['tier2'][:30]]"
```

- [ ] **Step 3: tier2 の全 entry id を /viewed で報告**

```bash
curl -sS -X POST https://buta.yuta25.workers.dev/viewed \
  -H "Authorization: Bearer <ADMIN_TOKEN>" -H "Content-Type: application/json" \
  -d '{"entryIds": [<step2のid一覧>]}'
```
Expected: `{"read":30,"feedsTouched":~30}`

- [ ] **Step 4: /feed を再取得し、回転を確認**

Expected: tier2 の feed_id 集合が **step 2 とほぼ入れ替わっている**（報告した feed は last_surfaced が前進し優先度が下がる）。これが確認できたらアンチスタベーション成立。

- [ ] **Step 5: Feedbin 側の既読反映も確認**

Feedbin の Web UI か `GET /v2/unread_entries.json` で、報告した id が未読一覧から消えていることを確認。

---

## Self-Review

**1. Spec coverage（DESIGN.md 状態モデル/トリアージUX）:**
- スクロール通過＝既読の書き戻し（Feedbin `DELETE unread_entries`）→ Task 1/3 ✓
- `last_surfaced` は「実際に通過した時」に前進、同じビュー報告経路で → Task 3 ✓
- Feedbin が真実の源（先に書く、失敗時ローカル無変更）→ Task 3/4 ✓
- スター代理書き込み → Task 1/4 ✓
- 全エンドポイント認証（単一トークン）→ Task 3/4 ✓
- 回転の実データ確認 → Task 5 ✓
- **非対象**: 手動掃除ボタン（PWA と一緒に plan 4）、exact-match dedup（必要になったら選別前段に挿入）、差分同期/retention（別途）。

**2. Placeholder scan:** 各ステップに実コードあり。曖昧指示なし。

**3. Type consistency:** `markEntriesRead`/`starEntries`/`unstarEntries` は Task 1 定義 → Task 3/4 で消費。`markEntriesReadLocal`/`setEntriesStarredLocal`/`getFeedIdsForEntries`/`touchFeedLastSurfaced` は Task 2 定義 → Task 3/4 で消費。`FLAG_ID_CHUNK` は既存定数を再利用。レスポンス形 `{read, feedsTouched}` / `{updated}` はテストと一致。

---

## 未解決（この plan の範囲外）

- 5 分毎の全量同期がビュー報告と競合した場合、Feedbin に先に書いているので次回同期で整合（自己修復）。ただし同期の全走査リセットはいずれ差分同期に置換。
- `/viewed` の冪等性: 同じ id を二重報告しても Feedbin/D1 とも安全（既読の既読化は no-op）。
