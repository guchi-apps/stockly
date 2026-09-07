# stockly 固有ルール

このリポジトリで作業する実装エージェントとレビュー・統合エージェント向けのルール。
GitHub Actions 上の無人実行は個人環境の設定を読まないため、必要な判断基準はこのファイルに置く。

## アプリ概要

Stockly は、食材・飲料・日用品・防災用品を一元管理する家庭在庫アプリ。
日常の在庫管理が主目的で、防災機能は日常在庫から非常時に使える量を自動集計する付加機能とする。

- Stocklyを在庫データの正本とする
- Notionは買い物リストなど生活管理の正本として維持し、Stocklyから補充候補を連携する
- 認証はSupabase Auth + Google OAuthを使用する
- 技術構成はNext.js 16 App Router、React 19、TypeScript、Tailwind CSS v4、Prisma、MariaDBを標準とする
- 本番URLは `https://stockly.gucchii.com/`、本番ポートは `3116`、DB名は `app_stockly`

## 出力言語

応答、計画、コミットメッセージ、Pull Request、Issueコメントは日本語で書く。
コード、識別子、パス、コマンド、設定値、ログは英語のままでよい。

## 開発フロー

- `develop`を日常の統合ブランチ、`main`を本番相当のリリースブランチとする
- Issueごとに`develop`から`issue-<Issue番号>`ブランチを作成し、専用worktreeで作業する
- 1つのブランチ・worktree・Pull Requestには1つのIssueだけを含める
- 実装担当は自分のPull Requestをマージしない。レビュー・統合担当を分離する
- `main`/`develop`への直接コミット・push、不要なforce push、他Issueのworktree編集を禁止する
- `develop`から`main`への反映は必ずPull Requestを使用し、ユーザー確認後に行う
- 認証・認可、DBスキーマ、GitHub Actions、デプロイ、Secrets・環境変数など高リスク変更は`22.merge-confirm-required`を付け、ユーザー確認なしにマージしない

## Issueの要件

各Issueには、目的、背景、受入条件、技術上の前提、依存・関連Issueを明記する。
実装前にIssue本文と最新コメントを読み、担当Issueの範囲だけを変更する。

## 検証

初期化Issueで次のscriptsを`package.json`へ定義し、実装後に実行する。

```bash
pnpm lint
pnpm typecheck
pnpm build:ci
```

`typecheck`は`next typegen && tsc --noEmit`、DBを使う`build:ci`は`prisma generate && next build`とする。
挙動が変わる変更は自動テストに加えて実際の動作も確認し、結果をPull Requestへ記録する。

## 依存関係とシークレット

- 新しい依存関係を追加する前にユーザー確認を得る
- 実シークレット、メールアドレス、家庭内の個人情報、在庫実データをコミットしない
- コミットしてよいのは空値の`.env.example`・`.env.local.example`と`op://`参照だけ
- 1Passwordを人が管理する正、GitHub Secrets/VariablesをActions実行時の取得先とする
- `.shared-context/`と`.shared-prompts/`は読み取り専用とし、コミットしない

## 共有知識

共通ルールは`guchi-apps/docs`を参照する。読み順は、Issueの指示、本ファイル、リポジトリ内docs、
共有知識の`CLAUDE.md`と`agent-rules/`、必要な`knowledge/`・`standards/`・`guides/`の順とする。

