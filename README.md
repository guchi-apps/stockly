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

## 開発運用

- 日常開発は`develop`、本番相当は`main`
- Issue単位で`issue-<Issue番号>`ブランチ、worktree、Pull Requestを分離
- 実装担当とレビュー・統合担当を分離
- `main`への反映と高リスク変更はユーザー確認必須
- 詳細は[CLAUDE.md](CLAUDE.md)と[AGENTS.md](AGENTS.md)を参照

現時点ではIssue分割と開発基盤だけを整備し、アプリ本体の実装は開始していません。
