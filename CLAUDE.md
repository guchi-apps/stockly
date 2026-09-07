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

## ディレクトリ構成

```
src/app/        App Routerのページ・レイアウト。manifest.ts・icon.svg・apple-icon.pngがPWAの定義
src/components/ 再利用UI。ui/はshadcn/uiが生成したもので、手で書いたものと混ぜない
src/lib/        ユーティリティ（utils.tsはshadcn/uiのcn、db.tsはPrismaClientのシングルトン）
src/lib/inventory/ 在庫ドメインの純関数（units.tsは単位換算、ledger.tsは履歴からの数量計算）
prisma/         schema.prisma・migrations・seed.ts
scripts/        開発・運用スクリプト（dev.shはPORTを解決してdevサーバーを起動する）
.github/        CI（ci.yml）とissue-deckの各caller、Signaly通知スクリプト
```

## データモデル

`prisma/schema.prisma`が在庫データの正本。次の3点が設計の前提で、崩すと在庫の履歴と取消が成立しない。

- **在庫の実体は`StockLot`**。同一商品・同一期限・同一保管場所のかたまりを1件とし、期限や保管場所が違えば別ロットにする
- **数量の増減は`InventoryTransaction`にappend-onlyで積む**。既存行のUPDATE・DELETEは行わず、取消は「符号を反転した`REVERSAL`行を足す」ことで表す。
  この形にしてあるため、現在数量は`quantityDelta`の**単純合計**で復元でき、取消済みの行を除外する処理が要らない。
  `StockLot.quantity`はその合計を保持する集計値で、正本は履歴のほう。ずれは`verifyLotQuantity()`で検出する
- **他家庭のデータを参照できないことをDB制約で担保する**。家庭に属する全モデルは`householdId`と`@@unique([householdId, id])`を持ち、
  子から親への参照は`[householdId, 親Id]`の複合外部キーにしてある。`householdId`が違う行はそもそも外部キーを満たせない。
  新しいモデルを足すときもこの形に揃える（単一列の外部キーにすると、この保証だけが静かに消える）

数量は必ず`Prisma.Decimal`と単位（`UnitCode`）の組で扱い、`src/lib/inventory/units.ts`の関数を通す。
`number`は小数の加算で誤差が出る。個数系の単位（個・パック・本…）は商品ごとの入数が分からないと互いに換算できないため、
`sumQuantities()`は換算できない組み合わせを黙って合算せず`UnitConversionError`を投げる。
合算できないものも落とさず並べたい場面では`groupSummableQuantities()`を使う。

## 検証

`package.json`に定義済みの次のscriptsを、実装後に実行する。

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm build:ci
```

`typecheck`は`next typegen && tsc --noEmit`、DBを使う`build:ci`は`prisma generate && next build`。
`build:ci`は`DATABASE_URL`を要求するが接続はしない（CIはプレースホルダーを渡す）。
`pnpm test`は上の4つのうちビルド以外をまとめて実行する。
挙動が変わる変更は自動テストに加えて実際の動作も確認し、結果をPull Requestへ記録する。

`test:unit`はNode標準のテストランナー（`node --test`）で`src/**/*.test.ts`を実行する。
Node 24がTypeScriptを型剥がしでそのまま実行できるため、テストランナーもトランスパイラも依存に足していない。
その代わり次の2点に注意する。

- **型注釈以外のTS構文は使えない**（`enum`・`namespace`・パラメータプロパティなど）。テスト・`prisma/seed.ts`と、
  そこから読まれる`src/lib/inventory/*`が対象
- **Nodeは拡張子を補完しない**ため、これらのファイルからのimportは`./units.ts`のように拡張子を書く
  （`tsconfig.json`の`allowImportingTsExtensions`で型検査側も許可済み。Next.jsのビルドもこの形を解決できる）

DBを使う確認は、初回だけ`pnpm db:setup`（`sudo mysql`を使うため人が実行する）でローカルのDBとユーザーを作り、
`pnpm db:migrate:dev` / `pnpm db:seed`で適用・投入する。

画面確認は`pnpm dev`で行う。ポートは環境変数`PORT` → `.env.local`の`PORT` → 3000 の順で決まる。
Issueごとのworktreeではセッションが環境変数`PORT`（`28000 + Issue番号`）を渡すため、
`.env.local`に書かなくてよい。`.env.local`自体が無い場合は`pnpm env:init`で雛形から作る。

CIのジョブ名`lint-and-build`は`develop`・`main`のbranch protectionの必須チェックであり、
ワークフロー名`CI`は`claude-ci-fix.yml`と`claude-conflict-resolve.yml`が購読している。
どちらも変更すると無言で止まるため、変える場合は参照側もあわせて直す。

## shadcn/uiのコンポーネント追加

`pnpm dlx shadcn@latest add <component>` で追加し、`src/components/ui/`のファイルは手で書いたものと混ぜない。
初期化は `shadcn@latest init -y -b radix -p nova` で行った（`components.json`の`style`は`radix-nova`）。
`-b`はコンポーネントライブラリ（`base` / `radix` / `aria`）で、baseColorではない。
`src/lib/utils.ts`の`cn`は`cn`パッケージの再エクスポートで、clsx + tailwind-mergeは入っていない。

## AGENTS.mdのNext.js管理ブロック

`AGENTS.md`の`<!-- BEGIN:nextjs-agent-rules -->`〜`<!-- END:nextjs-agent-rules -->`は
`next dev`が自動生成・再追記する。消しても再生成されるだけなので、差分に出たらそのままコミットする。

## 依存関係とシークレット

- 新しい依存関係を追加する前にユーザー確認を得る
- 実シークレット、メールアドレス、家庭内の個人情報、在庫実データをコミットしない
- コミットしてよいのは空値の`.env.example`・`.env.local.example`と`op://`参照だけ
- 1Passwordを人が管理する正、GitHub Secrets/VariablesをActions実行時の取得先とする
- `.shared-context/`と`.shared-prompts/`は読み取り専用とし、コミットしない

## 共有知識

共通ルールは`guchi-apps/docs`を参照する。読み順は、Issueの指示、本ファイル、リポジトリ内docs、
共有知識の`CLAUDE.md`と`agent-rules/`、必要な`knowledge/`・`standards/`・`guides/`の順とする。

