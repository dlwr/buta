# buta

自分専用の RSS バックエンド。Cloudflare Workers + D1 でフィードをクロールし、既製リーダーが接続できる互換 API を提供する。

- `/v2/*`: Feedbin API v2 互換（Capy Reader など Feedbin 対応クライアント向け）
- `/accounts/ClientLogin`, `/reader/api/0/*`: Google Reader API 互換（NetNewsWire の FreshRSS アカウントとして接続）
- `/admin/*`: OPML 取り込み、手動クロール

設計と互換範囲の詳細は [DESIGN.md](DESIGN.md)。

## セットアップ

```sh
pnpm install
npx wrangler d1 create buta            # database_id を wrangler.jsonc に反映
npx wrangler kv namespace create SYNC_KV
npx wrangler d1 migrations apply buta --remote
npx wrangler secret put API_EMAIL      # リーダーのログイン ID
npx wrangler secret put API_PASSWORD   # リーダーのパスワード
npx wrangler secret put ADMIN_TOKEN    # /admin の Bearer トークン
pnpm deploy
```

購読の投入:

```sh
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" --data-binary @feeds.opml https://<worker>/admin/opml
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" https://<worker>/admin/crawl
```

以後は 15 分ごとの cron がクロールする。

## クライアント設定

- Capy Reader: Feedbin アカウントとして追加し、URL に `https://<worker>/v2`、メール / パスワードに `API_EMAIL` / `API_PASSWORD`
- NetNewsWire: FreshRSS アカウントとして追加し、API URL に `https://<worker>`、ユーザー名 / パスワードに同じ値

## 開発

```sh
pnpm test
pnpm typecheck
```
