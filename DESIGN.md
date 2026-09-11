# buta — 設計メモ

自分専用の RSS バックエンド。フィードを自前でクロールし、Feedbin API v2 互換と Google Reader API（FreshRSS 方言）の両方を喋る。クライアントは既製のリーダー（Android: Capy Reader は Feedbin として、Mac: NetNewsWire は FreshRSS として接続）。

---

## 動機

- 当初は Feedbin を真実の源に、その上にトリアージ層を重ねる構成だった。D1 の全行 UPDATE を 5 分毎に回す実装で行課金が月 $170 規模になり停止。
- 読む体験は既製リーダーが解けている。自前で持つ価値があるのは **保存とクロールと選別のロジック**。そこで Feedbin を置き換え、既製リーダーが接続できる互換 API を提供する形にピボットした（2026-09）。
- コスト目標: Workers Paid $5/月、超過ゼロ。Feedbin の $5 が消えるので実質差し引きゼロ。

---

## アーキテクチャ

```
フィード (RSS / Atom / RDF / JSON Feed)
   ↓ 15 分毎 cron、条件付き GET、並列 20
Cloudflare Worker
   - crawl: feedsmith で正規化 → D1 entries に INSERT OR IGNORE → unread_entries に追加
   - /v2/*: Feedbin API v2 互換（Basic 認証、単一ユーザー）
   - /accounts/ClientLogin, /reader/api/0/*: Google Reader API 互換（NetNewsWire 用）
   - /admin/*: OPML 取り込み、手動クロール、旧データ引き継ぎ（Bearer）
   ↓
既製リーダー（Capy Reader / NetNewsWire / Reeder）が Feedbin アカウントとして接続
```

- D1 が真実の源。KV は cron の多重実行ロックだけ。
- 全行 UPDATE / DELETE は書かない。既読・スターは独立テーブルへの id 指定の追加・削除のみ。

---

## データモデル（migrations/0001_init.sql）

- `feeds`: 購読 = フィード（Feedbin の subscription.id と feed_id は同じ値）。ETag / Last-Modified / 失敗回数を持つ。
- `entries`: `UNIQUE(feed_id, dedup_key)`。dedup_key は guid → url → `title|published` の順。`published` は非 null（無ければクロール時刻）。
- `unread_entries` / `starred_entries`: entry_id だけの集合。
- `taggings`: フォルダ。`UNIQUE(feed_id, name)`。
- 削除は feeds → entries → marks に CASCADE。entries は自動では消さない（未読の自動破棄禁止は継続）。

---

## クロール

- cron `*/15`。KV `crawl_lock`（TTL 10 分）で多重実行を防ぐ。
- 全フィードを並列 20 で回す。ETag / Last-Modified を送り 304 ならパースしない。
- 失敗は `error_count` を増やし、`min(error_count, 8) × 15 分` の間スキップ。成功でリセット。
- 見積もり（300 フィード）: 読 150 万行/日、書 3 万行/日。Paid 込み枠（250 億読 / 5000 万書 / 月）の 1% 未満。

---

## Feedbin API 互換範囲

Capy Reader のソースで確認した使用エンドポイントを実装。

- `GET authentication.json`、`GET icons.json`（[]）、`GET saved_searches.json`（[]）、`POST pages.json`（501）
- `GET entries.json?page&since&per_page&ids&read=false&starred=true`、`GET feeds/:id/entries.json`、`GET entries/:id.json`
- `GET/POST/DELETE unread_entries.json`、`POST unread_entries/delete.json`（starred も同様）
- `GET/POST subscriptions.json`、`GET/PATCH/DELETE subscriptions/:id.json`
- `GET/POST taggings.json`、`GET/DELETE taggings/:id.json`、`POST/DELETE tags.json`

クライアントの癖:
- ページングは `Links` ヘッダ `<url>; rel="next", <url>; rel="last"`。Capy は `", "` と `"; "` で分割し各 URL の `?page=` を読むので、URL は必ず page を含み `,` を含まない。
- `Entry.published` / `created_at` は非 null 必須。`extracted_content_url` は null（本文抽出はフェーズ2）。
- `POST taggings.json` の `feed_id` は文字列で来る。
- `DELETE unread_entries.json` はボディ付き DELETE。

---

## Google Reader API 互換範囲

NetNewsWire の Feedbin 連携は接続先が api.feedbin.com 固定でカスタム URL を受けないため、FreshRSS アカウントとして繋ぐ第二の顔。NetNewsWire の ReaderAPICaller で使用を確認したものだけ実装。

- `POST /accounts/ClientLogin`（Email / Passwd）→ `Auth=<token>`。トークンは HMAC-SHA256(パスワード, "buta:auth:<email>") で状態を持たない。以降は `Authorization: GoogleLogin auth=<token>`。
- `GET token` → 書き込み用トークン（HMAC の kind を "write" にしたもの）。書き込みは form の `T` で検証。
- `GET tag/list`、`POST rename-tag`、`POST disable-tag`
- `GET subscription/list`、`POST subscription/edit`（ac=edit: t / a / r、ac=unsubscribe）、`POST subscription/quickadd`
- `GET stream/items/ids?s=&n=&ot=&xt=&c=`（s は reading-list / starred / feed/<id>、ot は created_at 基準、continuation は offset）
- `POST stream/items/contents`（i=tag:google.com,2005:reader/item/<hex16> または 10 進）
- `POST edit-tag`（a / r に read / starred）

記事 ID は entries.id を 16 桁 hex にしたもの。NetNewsWire は hex → Int64 → 10 進文字列に戻して itemRefs の id と突き合わせるので、itemRefs は 10 進文字列で返す。

---

## 運用

- シークレット: `API_EMAIL` / `API_PASSWORD`（Feedbin 側は Basic 認証、Reader 側は ClientLogin。同じ値）、`ADMIN_TOKEN`（/admin）。
- NetNewsWire: アカウント追加 → FreshRSS → API URL に `https://<worker>`、ユーザー名 / パスワードに API_EMAIL / API_PASSWORD。
- 移行: Feedbin の OPML → `POST /admin/opml` → `POST /admin/crawl` → `POST /admin/migrate-legacy`（旧 `legacy_entries` と URL 照合して既読・スターを引き継ぐ）。
- テスト: `@cloudflare/vitest-pool-workers` で D1 に migrations を適用して実 SQL を叩く。

---

## フェーズ2（未着手）

### トリアージの仮想タグ化

旧設計の核だった二層モデルを、リーダーに見える **仮想フォルダ** として復活させる。

- **Tier 1（コア必読）**: `Must Read` フォルダは全件時系列。これは既製リーダーのフォルダそのままで足りる。
- **Tier 2（長い尾）**: 残りのフォルダから 1 フィード 1 件（バースト時最大 3 件）、30 件/セッションを **多様性サンプリング + アンチスタベーション**（feed 単位の `last_surfaced` が古い順）で選び、`Sampled` という仮想 tagging の下に出す。サンプリングは提示順であって破棄ではない。
- `last_surfaced` は既読化 API（`DELETE unread_entries`）を受けた時に前進させる。リーダーのスクロール既読がそのまま信号になる。
- スパイク検証済みの結果: 素の時系列トップ 30 は 12 フィードに偏るが、サンプリングは 30 フィードに散る。last_surfaced 優先なら 10 セッションで全 278 フィードを巡回する。
- 純粋関数の実装は `src/selection/select.ts` に残してある（配線なし）。

### その他

- 本文抽出: `/extract?url=` を linkedom + @mozilla/readability で実装し `extracted_content_url` に載せる。`src/sanitize.ts` を通す。
- icons.json: favicon 取得。
- PWA（`src/pwa`、`public/`）: 仮想タグで足りるなら削除。
