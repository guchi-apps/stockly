# Stockly

食材・飲料・日用品・防災用品を一元管理し、日常在庫から非常時に使える備蓄を自動集計する家庭在庫アプリです。

## プロダクト方針

- 主目的は日常の在庫管理です
- 防災は在庫情報から非常時に使える物と備蓄日数を集計する付加機能です
- Stocklyを在庫データの正本とします
- Notionは買い物リストなど生活管理の正本として維持し、補充候補だけを連携します
- AIの候補は自動確定せず、信頼度を表示して確認・修正後に反映します

## 技術方針

- Next.js 16 App Router / React 19 / TypeScript
- Tailwind CSS v4 / shadcn/ui / Lucide React
- Prisma / MariaDB 10.11
- Supabase Auth + Google OAuth
- pnpm / PWA（オフライン対応は初期スコープ外）

Node.js 24、pnpm 10系（`package.json`の`packageManager`で固定）を使います。
本番URLは `https://stockly.gucchii.com/`、本番ポートは`3116`、DB名は`app_stockly`です。

## セットアップ

```bash
pnpm install
pnpm env:init      # .env.local.example から .env.local を作る
pnpm db:setup      # .env.local の DATABASE_URL からローカルのDB・ユーザーを作る（sudo mysql が要る）
pnpm db:migrate:dev
pnpm db:seed:dev   # 開発用ログインのダミー利用者・家庭を投入する
pnpm db:seed       # 在庫のサンプルデータを投入する（db:seed:dev の家庭へ入る）
pnpm db:seed:fixture # 画面の確認用データ（防災バッグ一式・水10L・期限切れなど）を投入する
pnpm dev           # 環境変数PORT → .env.localのPORT → 3000 の順で決めたポートで起動
```

`.env.local`には次の値が要ります。

| 変数 | 取得先 |
| --- | --- |
| `DATABASE_URL` | ローカルのMariaDB。DB名は本番と同じ`app_stockly` |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 1Password `apps/Supabase` の`project-url` / `publishable-key` |
| `ALLOWED_GOOGLE_EMAILS` | 利用を許可するGoogleアカウント（カンマ区切り）。**空だと誰もログインできません** |

## ログイン

Supabase Auth + Google OAuthでログインします。`/login`以外の画面はすべてログインが必要です。

- **利用可否は`ALLOWED_GOOGLE_EMAILS`で判定します。** 共有のSupabaseプロジェクトを他アプリと
  使っているため、「Supabaseで認証できること」と「Stocklyを使ってよいこと」は別です
- 在庫は家庭（Household）に属し、所属していない家庭のデータには到達できません。判定は
  `src/lib/household/access.ts`に閉じており、在庫を扱うクエリは`scopeToHousehold()`を通します
- ブラウザで確認するには、Supabaseの Redirect URLs に`http://localhost:<ポート>/auth/callback`の
  登録が必要です

### GUIの無い環境での確認（開発用ログイン）

Google OAuthは対話的な同意を経由するため、SSH越しの端末やCIではログインを完了できません。
開発・CI限定のログイン導線を用意してあります（**本番では`NODE_ENV=production`とシークレット
未設定の二重で無効**）。

```bash
pnpm db:seed:dev   # ダミーの利用者・家庭を投入し、CI_LOGIN_BYPASS_SECRET を .env.local へ生成
pnpm dev           # next dev は起動時に .env.local を読むので、生成後は起こし直す

curl -s -c /tmp/c.txt -o /dev/null -w '%{http_code} -> %{redirect_url}\n' \
  -X POST http://localhost:28002/api/dev/login     # 303 -> / なら成功
curl -s -b /tmp/c.txt http://localhost:28002/       # ログイン後の画面
```

## コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm dev` | 開発サーバー（ポートは環境変数`PORT` → `.env.local`の`PORT` → 3000 の順で決まる） |
| `pnpm lint` | ESLint（`eslint-config-next`） |
| `pnpm typecheck` | `next typegen && tsc --noEmit` |
| `pnpm test:unit` | 認証・家庭の境界のテスト（Node標準の`node --test`。DBに接続しない） |
| `pnpm test` | `lint` → `typecheck` → `test:unit` をまとめて実行 |
| `pnpm build:ci` | `prisma generate && next build` |
| `pnpm start` | ビルド済みアプリの起動 |
| `pnpm db:setup` | `.env.local`のDATABASE_URLからローカルのDB・ユーザーを作る |
| `pnpm db:seed:dev` | 開発用ログインのダミーデータとシークレットを用意する |
| `pnpm db:migrate:dev` / `pnpm db:migrate:deploy` | Prismaマイグレーション |
| `pnpm db:seed` | 在庫のサンプルデータ投入（`prisma/seed.ts`。`db:seed:dev`の家庭へ入れる） |
| `pnpm db:seed:fixture` | 受入条件の確認用データ投入（`prisma/fixtures/daily-inventory.ts`。防災バッグ一式・水10L・期限切れなど） |

`develop`・`main`向けのPull Requestでは、CI（`.github/workflows/ci.yml`）が上の
lint・型チェック・テスト・ビルドを実行します。

## アプリアイコン

`src/app/icon.svg`が原図です。書き出し済みのPNGを更新する場合は次を実行します。

```bash
rsvg-convert -w 192 -h 192 src/app/icon.svg -o public/icon-192.png
rsvg-convert -w 512 -h 512 src/app/icon.svg -o public/icon-512.png
rsvg-convert -w 180 -h 180 src/app/icon.svg -o src/app/apple-icon.png
```

## 本番デプロイ

`main`へのpushで`.github/workflows/deploy.yml`が動き、VPSへ配ります。実際の公開URLは
`https://stockly.gucchii.com/`で、経路はApache（443） → `127.0.0.1:3116` → PM2プロセス`stockly`です。

流れは、リリースタグの作成 → ビルド（`pnpm build:ci`） → 成果物をVPSへ転送 → `.env`の更新 →
`pnpm install --prod` → `prisma migrate deploy` → PM2の再起動 → ヘルスチェック → Signalyへ通知、の順です。
`develop`から`main`へのリリースPRは自動マージしない運用のため、公開は人がマージした時点で始まります。

デプロイに要る値は`.github/secrets-manifest.tsv`が正で、1Passwordを人が管理する唯一の正、
GitHub Secrets/VariablesをActions実行時の取得先とします。VPSへの接続情報・共有MariaDBの
接続情報・Supabaseの公開値はorganizationの共通値を継承し、このリポジトリ固有の値は
`TARGET_DIR`・`DB_NAME`・`ALLOWED_GOOGLE_EMAILS`の3つだけです。値を変えたときは
issue-deckの画面（設定 → シークレットの同期）か`sync-secrets.yml`で同期します。

待受ポート（3116）は1Passwordにもマニフェストにも置かず、`deploy.yml`に平文で持ちます。

## 開発運用

- 日常開発は`develop`、本番相当は`main`
- Issue単位で`issue-<Issue番号>`ブランチ、worktree、Pull Requestを分離
- 実装担当とレビュー・統合担当を分離
- `main`への反映と高リスク変更はユーザー確認必須
- 詳細は[CLAUDE.md](CLAUDE.md)と[AGENTS.md](AGENTS.md)を参照

現時点ではアプリの基盤（Next.jsの雛形・CI・PWA・開発環境）とログイン・家庭の境界までを
整備した状態で、在庫管理の画面とデータモデルは後続のIssueで実装します。
