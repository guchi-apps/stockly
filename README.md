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
pnpm env:init   # .env.local.example から .env.local を作る
pnpm dev        # 環境変数PORT → .env.localのPORT → 3000 の順で決めたポートで起動
```

DBを使う画面はまだありませんが、`prisma generate`をビルド前に実行するため
`.env.local`の`DATABASE_URL`は形式が正しい値にしておいてください。

## コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm dev` | 開発サーバー（ポートは環境変数`PORT` → `.env.local`の`PORT` → 3000 の順で決まる） |
| `pnpm lint` | ESLint（`eslint-config-next`） |
| `pnpm typecheck` | `next typegen && tsc --noEmit` |
| `pnpm build:ci` | `prisma generate && next build` |
| `pnpm start` | ビルド済みアプリの起動 |
| `pnpm db:migrate:dev` / `pnpm db:migrate:deploy` | Prismaマイグレーション |

`develop`・`main`向けのPull Requestでは、CI（`.github/workflows/ci.yml`）が上の
lint・型チェック・ビルドを実行します。

## アプリアイコン

`src/app/icon.svg`が原図です。書き出し済みのPNGを更新する場合は次を実行します。

```bash
rsvg-convert -w 192 -h 192 src/app/icon.svg -o public/icon-192.png
rsvg-convert -w 512 -h 512 src/app/icon.svg -o public/icon-512.png
rsvg-convert -w 180 -h 180 src/app/icon.svg -o src/app/apple-icon.png
```

## 開発運用

- 日常開発は`develop`、本番相当は`main`
- Issue単位で`issue-<Issue番号>`ブランチ、worktree、Pull Requestを分離
- 実装担当とレビュー・統合担当を分離
- `main`への反映と高リスク変更はユーザー確認必須
- 詳細は[CLAUDE.md](CLAUDE.md)と[AGENTS.md](AGENTS.md)を参照

現時点ではアプリの基盤（Next.jsの雛形・CI・PWA・開発環境）だけを整備した状態で、
在庫管理の画面とデータモデルは後続のIssueで実装します。
