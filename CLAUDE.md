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
src/proxy.ts    全リクエストの入口（Next.js 16では旧middleware.ts）。認証の判定はここだけ
src/components/ 再利用UI。ui/はshadcn/uiが生成したもので、手で書いたものと混ぜない
src/lib/auth/   認証まわり（許可メール・戻り先の正規化・現在ユーザー・開発用ログイン）
src/lib/household/ 家庭の境界。在庫を扱うクエリは必ずaccess.tsを通す
src/lib/supabase/  Supabaseクライアントとセッション更新（middleware.ts）
prisma/         schema.prismaとmigrations。在庫のモデルは後続Issueで追加する
scripts/        開発・運用スクリプト（dev.shはPORTを解決してdevサーバーを起動する）
.github/        CI（ci.yml）とissue-deckの各caller、Signaly通知スクリプト、secrets-manifest.tsv
```

## 検証

`package.json`に定義済みの次のscriptsを、実装後に実行する。

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm build:ci
```

`typecheck`は`next typegen && tsc --noEmit`、DBを使う`build:ci`は`prisma generate && next build`。
`test:unit`はNode標準の`node --test`で`src/**/*.test.ts`を実行する（テストランナーの依存は入れていない）。
テストからの相対importは`./access.ts`のように拡張子を付ける（Nodeが拡張子付きしか解決しないため。
tsconfigの`allowImportingTsExtensions`はこのために有効にしている）。DB・外部サービスには接続しない。
`build:ci`は`DATABASE_URL`を要求するが接続はしない（CIはプレースホルダーを渡す）。
挙動が変わる変更は自動テストに加えて実際の動作も確認し、結果をPull Requestへ記録する。

画面確認は`pnpm dev`で行う。ポートは環境変数`PORT` → `.env.local`の`PORT` → 3000 の順で決まる。
Issueごとのworktreeではセッションが環境変数`PORT`（`28000 + Issue番号`）を渡すため、
`.env.local`に書かなくてよい。`.env.local`自体が無い場合は`pnpm env:init`で雛形から作る。

CIのジョブ名`lint-and-build`は`develop`・`main`のbranch protectionの必須チェックであり、
ワークフロー名`CI`は`claude-ci-fix.yml`と`claude-conflict-resolve.yml`が購読している。
どちらも変更すると無言で止まるため、変える場合は参照側もあわせて直す。

**`lint-and-build`の検証ステップを増やしたら、`claude-ci-fix.yml`と`claude-pr-repair.yml`の
`verify-commands`も同じ内容へ直す。** あの文字列は無人修復エージェントへのプロンプトへそのまま
埋め込まれ、コマンド名だけでなく本数まで書いてある。直し忘れると、新しいステップを実行しないまま
「検証済み」としてpushされ、CIが落ち続ける。

## 認証と家庭の境界

- **セッションの検証は`src/proxy.ts`（→`src/lib/supabase/middleware.ts`）が1リクエストにつき1回だけ行う。**
  画面・APIでは`supabase.auth.getUser()`を呼ばず、`src/lib/auth/current-user.ts`の`getCurrentUser()`
  等を使う。`getUser()`は毎回Supabaseへ往復するため、呼び直すと待ち時間が倍になる
- 検証済みのユーザーIDは`x-stockly-supabase-user-id`ヘッダーで後段へ渡す。proxyが必ず上書きか削除を
  するので詐称は届かないが、**proxyのmatcherから外したパスではこの前提が崩れる**
- **利用可否は`ALLOWED_GOOGLE_EMAILS`で判定する**（`src/lib/auth/allowed-emails.ts`）。共有のSupabase
  プロジェクトを他アプリと使っているため、認証できることと利用してよいことは別。未設定時は全員拒否
- 在庫を扱うクエリは`src/lib/household/access.ts`の`scopeToHousehold()`を通す。画面ごとに
  `where: { householdId }`を手で書かない（1か所の書き忘れがそのまま越境になる）
- ログイン後の戻り先は`resolveInternalPath()`で正規化する（open redirectの防止）
- 開発用ログイン（`POST /api/dev/login`）は`NODE_ENV=production`とシークレット未設定の**二重**で
  無効化する。片方だけ緩めない

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

