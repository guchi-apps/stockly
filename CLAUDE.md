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

**DBスキーマを触るIssueでは、着手前に他のopenなIssueの受入条件と計画コメントを読む。**
`prisma/migrations/`がまだ薄い段階では、並行するIssueが同じモデルや初期マイグレーションを
二重に作りやすい（実際に#2と#3で起きた）。起動時の並行状況スナップショットには他セッションの
未コミットの作業が映らないため、「重なりうる組 0件」でも安心できない。重なりを見つけたら、
どちらがモデルの正本を持つかをIssueコメントで先に合意する。

## Issueの要件

各Issueには、目的、背景、受入条件、技術上の前提、依存・関連Issueを明記する。
実装前にIssue本文と最新コメントを読み、担当Issueの範囲だけを変更する。

## ディレクトリ構成

```
src/app/        App Routerのページ・レイアウト。manifest.ts・icon.svg・apple-icon.pngがPWAの定義
src/app/(app)/  在庫・期限・履歴・補充・防災・保管場所・メニューの画面とServer Action（actions.ts）。共通の外枠はlayout.tsx
src/proxy.ts    全リクエストの入口（Next.js 16では旧middleware.ts）。認証の判定はここだけ
src/components/ 再利用UI。ui/はshadcn/uiが生成したもので、手で書いたものと混ぜない
src/lib/auth/   認証まわり（許可メール・戻り先の正規化・現在ユーザー・開発用ログイン）
src/lib/household/ 家庭の境界。在庫を扱うクエリは必ずaccess.tsを通す
src/lib/inventory/ 在庫ドメイン。純関数（units・ledger・operations・expiry）と、DBを触るservice・queries・settings
src/lib/replenishment/ 補充ドメイン（#6）。不足量の算出（shortage）・入力の読み取り（rules）と、service・queries
src/lib/disaster/ 防災ドメイン（#7・#8）。区分と必要量の定義（rules）・判定（assess）と、queries・settings。
                   バッグの点検（bag・bag-queries）は判定を呼ぶだけで、判定ルールを持たない
src/lib/notion/    Notion買い物リストへの送信（config・client）。読み取りAPIは使わない
src/lib/notifications/ 通知（#5）。チャネル境界（channels）・重複防止（service）・期限ジョブ（expiry-job）
src/lib/time/   日付の境目（tokyo.ts）。期限の「今日」はここだけで決める
src/components/inventory/ 在庫画面の部品（一覧・期限バッジ・記録ボタン・フォーム）
src/components/replenishment/ 補充基準のフォーム
src/components/disaster/ 防災の集計の見せ方（coverage-summary）・基準のフォームと、バッグの点検（bag-inspection・bag-forms）
src/lib/supabase/  Supabaseクライアントとセッション更新（middleware.ts）
prisma/         schema.prisma・migrations・seed.ts（サンプル）・fixtures/（受入条件の確認用データ）
docs/           テスト戦略・検証基準（testing-strategy.md）とバックアップ・復元手順（backup-restore.md）
db-tests/       実DB（MySQL/MariaDB）に接続して複合外部キー等のDB制約を検証するテスト（#18）。
                `pnpm test:unit`とは別に`pnpm test:db`で実行する
scripts/        開発・運用スクリプト（dev.shはPORTを解決してdevサーバーを起動する。
                run-expiry-notifications.tsは`pnpm job:expiry`＝期限通知のバッチ）
deploy/         PM2のecosystem.config.js。本番のプロセス名は`stockly`で待受は3116
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
`build:ci`の後に`bash scripts/check-dev-login-disabled.sh`（本番ビルドを実起動し、開発用ログインが404で
未ログインが`/login`へ戻ることをHTTPで確かめるスモーク。#13）もCIの`lint-and-build`で実行する。
**どの層で何をテストするか・機能Issueが同梱すべきテスト・セキュリティ検証の一覧は
[docs/testing-strategy.md](docs/testing-strategy.md)**、バックアップ・復元・履歴からの再構築は
[docs/backup-restore.md](docs/backup-restore.md)にある。
`test:unit`はNode標準の`node --test`で`src/**/*.test.ts`を実行する（テストランナーの依存は入れていない）。
テストからの相対importは`./access.ts`のように拡張子を付ける（Nodeが拡張子付きしか解決しないため。
tsconfigの`allowImportingTsExtensions`はこのために有効にしている）。DB・外部サービスには接続しない。
**Nodeの実行はstrip-onlyモードなので、型注釈以外のTS構文（`enum`・`namespace`・パラメータプロパティ）は
`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`で落ちる。** テスト・`prisma/seed.ts`と、そこから読まれるモジュールでは
`enum`を使わず、union型か`as const`オブジェクトで書く。
`build:ci`は`DATABASE_URL`を要求するが接続はしない（CIはプレースホルダーを渡す）。
挙動が変わる変更は自動テストに加えて実際の動作も確認し、結果をPull Requestへ記録する。

DBを使う確認は、初回だけ`pnpm db:setup`（`sudo mysql`を使うため人が実行する）でDBとユーザーを作り、
`pnpm db:migrate:dev` → `pnpm db:seed:dev`（開発用ユーザーと家庭）→ `pnpm db:seed`（在庫のサンプルデータ）
の順に流す。`db:seed`は`db:seed:dev`が作る家庭（`dev-household-own`）へ在庫を入れる。

**他家庭のデータを参照できないことを保証する複合外部キー（後述「データモデル」）は、`db-tests/`で
実DBに接続して検証する（`pnpm test:db`。#18）。** `pnpm test:unit`とは別コマンドで、DBが無い
環境では実行しない・できない。ローカルで動かす場合は`pnpm db:migrate:deploy` → `pnpm db:seed`の
あとに`pnpm test:db`を実行する。`db-tests/**/*.test.ts`は`node --test`が.env.localを読まない
ため、`db-tests/helpers.ts`が`dotenv`で明示的に読み込む。
**db-testsが作った家庭の後始末は`deleteHousehold()`を使い、`prisma.household.delete()`を直接呼ばない。**
`Household`の削除はCascadeで配下へ伝わるが、`StockLot → Product`と`REVERSAL → 取消対象`が`Restrict`のため、
在庫と履歴を持つ家庭はMariaDBのエラー1217で消せない（Cascadeの伝播順は保証されない）。ヘルパーは
取消行 → 履歴 → ロット → 家庭の順に消す。以前は失敗を握り潰していたため、実行のたびに検証用の家庭が
残り続けていた（#13）。
**db-testsで「書き込みが拒否されること」を確かめるときは、Prismaのエラーコードだけで判定しない。**
MySQLは外部キー違反に1452と1216の2つのコードを持ち、どちらを返すかはサーバーのビルドで変わる
（CIのmysql:8.0は1452でPrismaが`P2003`へ移すが、ローカル・本番のMariaDBは1216で
`PrismaClientUnknownRequestError`のまま届く）。コードだけで判定すると、制約は効いているのに
ローカル・本番だけでテストが落ち、「境界が壊れている」と誤読される。
**「拒否されたこと」だけを確かめたいときは`helpers.ts`の`assertRejectedByDatabase()`を使う**（#44）。
エラーの種類は問わず、「DBまで往復したエラーであること」と「行が実際に増えていないこと」で
確かめる（`household-boundary.test.ts`）。**外部キー違反であることまで区別したいときは同じく
`helpers.ts`の`isForeignKeyViolation()`を使う**（#9、`barcode-learning.test.ts`）。1452と1216の
どちらでも真になるよう、コードに加えてメッセージの`foreign key constraint fails`も見る。
一意制約（1062 → `P2002`）はどちらのDBでも同じにマップされるため、そちらは`isUniqueViolation()`で
コードのまま判定してよい。
`.github/workflows/ci.yml`には`lint-and-build`とは別に`db-constraint-tests`ジョブがあり、
MySQLのサービスコンテナに対して`prisma migrate deploy` → `prisma db seed` → `pnpm test:db`を
実行する。**このジョブはbranch protectionの必須チェックには含めていない**（必須チェックは
`lint-and-build`のみ）。**`claude-ci-fix.yml`・`claude-pr-repair.yml`の無人修復エージェントは
実DBを持たないため、このジョブの失敗を`pnpm test:db`で確認しながら直すことはできない**
（`verify-commands`にその旨を明記してある）。

**GUIが無い環境でServer Actionまで確かめるには、`multipart/form-data`でPOSTする**（#6）。
JSを読まない`curl`でも、Next.jsがフォームへ埋める`$ACTION_ID_…`を拾って送ればアクションが動く。
ただし`Content-Type: application/x-www-form-urlencoded`だと**アクションは実行されずページのHTMLが
200で返るだけ**なので、成功したように見えて何も起きない。`curl -F "$ACTION_ID_…=" -F "<欄>=<値>"`とし、
`Location`ヘッダーの`?notice=`／`?error=`で結果を見る（サーバーコンポーネントのフォームだけ。
`useActionState`を使うクライアント側のフォームはHTMLにIDが出ないので、この手では叩けない）。

**`useActionState`のフォームをcurlで叩くときは、フォームの欄を`0`より前に置く**（#8）。
サーバーコンポーネントのフォームと違い`$ACTION_ID_…`はHTMLに出ないので、`Next-Action:<id>`
ヘッダーで叩くことになる。idは`.next/dev/server/server-reference-manifest.json`にある
（`.next/server/…`のほうは本番ビルドのidで、devでは404になる）。引数は
`-F '_1_<欄>=<値>' … -F '0=[{"errors":{},"values":{}},"$K1"]'`の形で、**FormDataの部品
（`_1_…`）を`0`より先に送る**。Reactは`0`を読んだ時点でFormData参照を解決するため、
後ろに置くと**エラーにならず、空のFormDataがアクションへ渡る**（欄を1つも入力していない
ときと同じ応答が返るので、送れているように見えて気付きにくい）。

**外部APIの入口（base URL）は設定値にしておく**（#6の`NOTION_API_BASE_URL`）。ローカルに数十行の
スタブを立てて向ければ、送信・再送・失敗・復旧までを実際に流して確かめられる。本番の値を
入れずに済むうえ、「失敗しても在庫が変わらない」のような**壊れ方の確認**が普通のテストでできる。

画面確認は`pnpm dev`で行う。ポートは環境変数`PORT` → `.env.local`の`PORT` → 3000 の順で決まる。
Issueごとのworktreeではセッションが環境変数`PORT`（`28000 + Issue番号`）を渡すため、
`.env.local`に書かなくてよい。`.env.local`自体が無い場合は`pnpm env:init`で雛形から作る。

CIのジョブ名`lint-and-build`は`develop`・`main`のbranch protectionの必須チェックであり、
ワークフロー名`CI`は`claude-ci-fix.yml`と`claude-conflict-resolve.yml`が購読している。
どちらも変更すると無言で止まるため、変える場合は参照側もあわせて直す。

`StockLot.quantity`が履歴とずれたときは`pnpm db:rebuild-quantities`（dry-run）で一覧し、
`-- --apply`で履歴の合計へ戻す（`src/lib/inventory/rebuild.ts`。手順は`docs/backup-restore.md`）。

**`lint-and-build`の検証ステップを増やしたら、`claude-ci-fix.yml`と`claude-pr-repair.yml`の
`verify-commands`も同じ内容へ直す。** あの文字列は無人修復エージェントへのプロンプトへそのまま
埋め込まれ、コマンド名だけでなく本数まで書いてある。直し忘れると、新しいステップを実行しないまま
「検証済み」としてpushされ、CIが落ち続ける。

## 本番デプロイ

`main`へのpushで`.github/workflows/deploy.yml`が動く。経路は
Apache（`stockly.gucchii.com`:443） → `127.0.0.1:3116` → PM2プロセス`stockly`。

- **待受ポート3116は`deploy.yml`に平文で持つ**（`guchi-apps/docs`の`standards/ports.md`。
  1Passwordにもマニフェストにも入れない）。`deploy/ecosystem.config.js`の既定値も同じ番号に揃える。
  PM2は再起動時に`--env production`を失うことがあるため、`env`と`env_production`の両方へ書く
- **タグとGitHub Releaseを作るのは`deploy.yml`の`tag`ジョブだけ。** `version-tag-check.yml`は
  main宛PRの時点で「`package.json`の`version`に対応するタグがまだ無いこと」を確かめており、
  この2つは対になっている。片方だけ変えるとリリースが止まる
- **`DATABASE_URL`は持たず、`DB_*`から`scripts/construct-database-url.sh`が組み立てる。**
  パスワードをURLエンコードして埋め込むため、値を丸ごと持つとActionsのログでマスクが効かない
  （このリポジトリはPUBLIC）。`prisma migrate deploy`だけはDDL権限のある`MIGRATE_DATABASE_URL`を使う
- **VPS上の`.env`は`scripts/update-env-file.sh`が書いたキーだけを更新する。** 実行時に要る値は
  `deploy.yml`の`update_env`へ必ず並べること。サーバー上で手で足した値は次のデプロイで
  参照されないまま取り残される
- デプロイに要る値の対応表は`.github/secrets-manifest.tsv`が正。VPS接続・共有MariaDB・Supabaseの
  公開値はorganizationの共通値を`inherit`し、このリポジトリ固有は`TARGET_DIR`・`DB_NAME`・
  `ALLOWED_GOOGLE_EMAILS`だけ。**`repo`なのにSOURCEが`-`の行を作らない**（同期が必ず失敗し、
  値が空のままワークフローだけ通る）
- **公開URLで別アプリの画面が出たら、まず証明書のCNを見る。** `*.gucchii.com`はワイルドカードで
  VPSへ向いているため、vhostが無いホスト名でもTLSハンドシェイクまで成立し、Apacheが443番の
  既定vhostを返す。DNSもプロセスも正常に見えるのに中身だけ違うので気付きにくい。
  `echo | openssl s_client -connect stockly.gucchii.com:443 -servername stockly.gucchii.com 2>/dev/null | openssl x509 -noout -subject`
  のCNが別ドメインなら、Stocklyのvhostがまだ無い（#26で実際にops-dashboardが表示されていた）
- deployジョブの成功は公開できたことを保証しない。ヘルスチェックが叩くのはVPS内の
  `127.0.0.1:3116`で、ApacheのVirtualHostが無くても通る。公開URLの疎通は後段の警告のみのステップで見る

## データモデル

`prisma/schema.prisma`が在庫データの正本。前半が利用者と家庭の境界（#2）、後半が在庫（#3）。
在庫側は次の3点が設計の前提で、崩すと在庫の履歴と取消が成立しない。

- **在庫の実体は`StockLot`**。同一商品・同一期限・同一保管場所のかたまりを1件とし、期限や保管場所が違えば別ロットにする
- **数量の増減は`InventoryTransaction`にappend-onlyで積む**。既存行のUPDATE・DELETEは行わず、
  取消は「符号を反転した`REVERSAL`行を足す」ことで表す。この形にしてあるため、現在数量は
  `quantityDelta`の**単純合計**で復元でき、取消済みの行を除外する処理が要らない。
  `StockLot.quantity`はその合計を保持する集計値で、正本は履歴のほう。ずれは`verifyLotQuantity()`で検出する
- **他家庭のデータを参照できないことをDB制約で担保する**。家庭に属する全モデルは`householdId`と
  `@@unique([householdId, id])`を持ち、子から親への参照は`[householdId, 親Id]`の複合外部キーにしてある。
  `householdId`が違う行はそもそも外部キーを満たせない。`StockLot`の詳細位置はさらに
  `[householdId, storageLocationId, storagePositionId]`で参照するため、指定した保管場所の配下にない位置も選べない。
  **新しいモデルを足すときもこの形に揃える**（単一列の外部キーにすると、この保証だけが静かに消える）

`access.ts`の`scopeToHousehold()`はアプリ側の入口の担保で、この複合外部キーはDB側の最後の砦。
どちらか一方だけにしない。

数量は必ず`Prisma.Decimal`と単位（`UnitCode`）の組で扱い、`src/lib/inventory/units.ts`の関数を通す。
`number`は小数の加算で誤差が出る。個数系の単位（個・パック・本…）は商品ごとの入数が分からないと互いに換算できないため、
`sumQuantities()`は換算できない組み合わせを黙って合算せず`UnitConversionError`を投げる。
合算できないものも落とさず並べたい場面では`groupSummableQuantities()`を使う。

**`Prisma.Decimal`の`isPositive()`は0でもtrueを返す**（decimal.jsは0の符号を+として持つため）。
「0より大きい」を判定したいところでは`greaterThan(0)`を使う。`isPositive()`のままだと、
数量が0になったロットが「まだ在庫がある」と判定される。

## 在庫の読み書き

- **在庫を変える処理は`src/lib/inventory/service.ts`だけが行う。** 画面・Server Actionから
  `db.stockLot.update()`のような書き込みをしない。読み取りも`queries.ts`を通す
  （どちらも先頭で`scopeToHousehold()`を通り、そこで返った`householdId`だけをwhereに使う）
- **二重送信の防止に専用の列は持たない。** 画面がフォームへ埋めた操作ID（`newOperationId()`で
  1レンダーにつき1つ発行）を、そのまま`InventoryTransaction.id`に使う。2回目の送信は主キーの
  重複になるので、`status: "duplicate"`として何も足さずに返す。**冪等キーの列を足したくなったら、
  まずこの方式で足りない理由を確かめること**（`InventoryTransaction`はappend-onlyなので、
  「同じ操作＝同じ履歴1件」がそのまま冪等性になる）
- 同じロットへの記録が同時に走ると集計値だけがずれるため、数量を読む前に
  `SELECT ... FOR UPDATE`でロット行をロックする（`service.ts`の`lockLot()`）
- 競合の検出（`expectedUpdatedAt`）は**編集画面だけ**。消費・補充のような相対的な増減は、
  他の人が先に記録していても意味が壊れないので使わない。使うと、家族が同時に触るたびに
  やり直しを求めることになる
- **取消で数量が負になることは許し、負のロットはACTIVEのまま一覧に残す。** 買ったぶんを消費した
  あとでその購入を取り消せば負になるのが履歴として正しい。DEPLETEDにすると一覧から消え、
  訂正する手段が無くなる
- 画面の確認用データは`pnpm db:seed:fixture`（`prisma/fixtures/daily-inventory.ts`）。
  流すたびに`fx-`で始まる在庫・履歴を作り直すので、画面で試した記録が残らない

## バーコードと学習ルール（#9）

- **候補の優先順位は「確定済みルール > バーコードマスタ > AI候補」**。組み立てるのは
  `src/lib/barcode/candidate.ts`の`buildStockLotCandidate()`（純関数）で、欄ごとにどれを採ったかを
  一緒に返す。画面はその出所をチップで出す。**強いほうが空でも弱いほうへ落ちるのは値が無いときだけ**で、
  「新しいほうを採る」といった別の規則を混ぜない
- **確定済みルール（`ProductRule`）は商品1つにつき1行。** 在庫を登録・編集して確定するたびに上書きする。
  **期限は日付ではなく日数（`shelfLifeDays`）で覚える**——日付を覚えると、次に買ったときには必ず過ぎている
- **1つのコードは家庭内で1商品にしか紐付かない**（`@@unique([householdId, code])`）。直す手段は
  「付け替え」と「解除」だけで、2件目を作らない。付け替えずに別商品として登録されたら
  `Barcode.mismatchCount`を増やし、3回で誤紐付けの疑いとして`/barcodes`の先頭に出す
- **コードの値は必ず`parseBarcode()`を通してからDBへ渡す。** 全角・ハイフン・空白の混ざった値を
  そのまま入れると、同じ商品に見た目違いの紐付けが増える。チェックディジットが合わない値は拒否する
- **読み取りは`BarcodeDetector`のAPI一本で書く。** 標準実装があるブラウザはそれを使い、無い場合
  （iOS Safari）だけ`barcode-detector`のponyfill（ZXingのWebAssembly）を**動的import**で読む。
  静的importにすると、標準実装のある環境へ1MBのwasmを配ることになる
- **wasmは`public/zxing/zxing_reader-<バージョン>.wasm`から自前配信する**（既定はjsDelivrのCDN）。
  `zxing-wasm`を上げたらこのファイルも差し替える。ファイル名にバージョンが入っているので、
  忘れると404で気付ける（黙って古いwasmが使われることはない）
- **`.wasm`は`src/proxy.ts`のmatcherから外してある。** 通すと読み取りのたびにSupabaseへ往復し、
  セッションが切れた瞬間にHTMLが返って`WebAssembly.instantiate`が原因の分かりにくい形で落ちる
- カメラは**httpsかlocalhostでしか使えない**。LANの生IPで開くと`navigator.mediaDevices`自体が
  生えないため、スマホ実機で試すときは`sslip.io`＋httpsが要る（`sslip-io-lan-dev` skill）

## 補充とNotion買い物リスト連携（#6）

**Stocklyが在庫の正本、Notionが買い物リストの正本**という分担を崩さない。Stocklyから送るのは
補充候補だけで、**Notion側の完了・編集・削除はStocklyへ読み戻さない**（`src/lib/notion/client.ts`が
持つのは「ページを作る」「ページを更新する」の2つだけで、読み取りAPIは呼ばない）。

- **不足の判定は`ReplenishmentRule`（商品ごと・カテゴリごとに1件）**。`thresholdAmount`以下に
  なったら`targetAmount`までの差を不足量にする。判定単位へ**換算できない在庫と期限切れの在庫は
  数えない**（数えると買い忘れる）。除いた件数は画面に出す。ただし商品が内容量
  （`Product.contentAmount`／`contentUnit`）を持っていればそこを通して換算するので、
  「1本=2L」の水は`LITER`の基準で数えられる
- **送信の記録は`ShoppingListEntry`で、対象ごとに1件だけ**（`@@unique([householdId, productId])`と
  `@@unique([householdId, categoryId])`。MySQLのUNIQUEはNULLを重複扱いしないので、
  商品の行とカテゴリの行を同じ表に置ける）。2回目以降の送信は`notionPageId`のページを更新するため、
  **同じ候補を送り直してもNotionの項目が増えない**。作り直したいときは行を消す（画面の「取り下げる」）
- **Notionへの通信をDBのトランザクションの中で行わない。** 送信は1件ずつ、`SENDING`で印を付けてから
  外で行い、結果（`SENT`／`FAILED`＋`lastError`）を書き戻す。失敗しても行は残り、そのまま送り直せる。
  在庫は最初から変えていないので、戻すものは無い
- **接続先は環境変数（`NOTION_API_TOKEN`・`NOTION_SHOPPING_DATABASE_ID`）で、実値はコミットしない。**
  未設定でも補充の画面は開き、送信だけができない（設定漏れで在庫の画面まで止めない）。
  プロパティ名は`NOTION_SHOPPING_*_PROPERTY`で差し替えられる（既定のタイトルは「名前」。
  設定していない任意のプロパティは送らない——存在しないプロパティを送るとNotionが400を返すため）
- 送信は1件ずつ`SEND_INTERVAL_MS`（400ms）空け、1回の送信は`MAX_SEND_BATCH_SIZE`（20件）まで。
  Notionのレート制限（平均3リクエスト/秒）に触れないための歯止め

## 防災ストックの判定（#7）

日常の在庫から「非常時に何日ぶんあるか」を出す付加的な集計。**別在庫は作らず、
`Product`の防災属性（温度帯・加熱/水の要否・用途・内容量/食数/使用回数）だけで判定する。**
判定は`src/lib/disaster/assess.ts`の純関数で、**生成AIには委ねない**（受入条件）。

- **集計は6区分**（食料・飲料・衛生・照明・電源・熱源）。`EmergencyRole`をどの区分で
  どの単位で数えるかは`rules.ts`の`DISASTER_CATEGORY_RULES`が正本。**`EmergencyRole`へ値を
  足したらここも直す**——載っていない役割（`NONE`・`UTILITY_WATER`・`MEDICAL`・`OTHER`）は
  集計から静かに落ちる
- **必要量の伸び方は区分ごとに違う**（`scale`）。水・食事・携帯トイレは人数×日数、
  照明・電源は人数だけ（1人1個。使うほど減らないので**備蓄日数を出さない**）、熱源は日数だけ
  （家族で1つの火を使う）。**全体の備蓄日数は、日数を出せる区分のうちいちばん短いもの。**
  平均にすると、水だけ足りている家庭が「2日ぶんある」と読める
- **数えない在庫は、外した理由つきで必ず画面に出す**（受入条件の「根拠と除外理由を追跡できる」）。
  理由は期限切れ・期限が要確認・冷蔵・冷凍・開封済み・換算できない・熱源がない・水がない・残量なし。
  件数だけだと「無い」のか「安全側に倒して数えていない」のかが読み分けられない
- **冷蔵・冷凍は既定で数えない。** 停電で使えなくなるため。含めるには`includeChilled`／
  `includeFrozen`を画面で明示的に立てる（**明示設定なしに例外化しない**）。温度帯は
  **商品と保管場所の厳しいほう**を採る（常温品でも冷蔵庫に入っていれば温まる）
- **期限切れと期限が未確認（`UNKNOWN`）の在庫は、どの設定でも数えない。** 過大評価を避ける側へ倒す。
  開封済み（飲みかけ）は既定で数えないが、`includeOpened`で数えられる
- **加熱・水が要る食料は、熱源・飲料水があるときだけ数える**（既定）。他の区分に依存するため
  `assess.ts`は**2周に分けて評価する**（1周目で熱源と飲料水の有無を出し、2周目で本判定）。
  依存はこの一方向だけで循環しない
- **基準は家庭ごとに`DisasterPlanSetting`が持つ**（人数・目標日数・1人1日あたりの必要量・
  何を数えるか）。行が無い家庭は`DEFAULT_DISASTER_PLAN`で動く。**スキーマの`@default`と
  コードの既定値は別々に書いてあるので、片方だけ変えない**（`db-tests/disaster-plan.test.ts`が
  一致を見ている）
- **判定結果はテーブルに保存しない。** 在庫が動けば結果は変わるので、残した行はすぐ古くなる。
  受入条件の「ルールの版を記録し、後から判定結果を再説明できる」は、
  ①`DISASTER_RULE_VERSION`を基準の保存時に書き、判定結果にも埋める
  ②ルール版・基準・根拠ロット・除外理由をすべて画面に出す
  ③`assess.ts`が純関数で、同じ入力なら必ず同じ結果になる——の3つで満たす。
  **同じ在庫から違う数字が出るようになったら版を上げる**（文言や並び順だけの変更では上げない）

## 防災バッグの点検（#8）

`/disaster`の集計とは別に、**バッグ1つを点検の単位として見る**画面（`/disaster/bags`）。
判定は`assess.ts`をそのまま呼び、**UI側にもバッグ側にも判定ルールを持たない**（受入条件）。

- **バッグの実体は`StorageLocation`（種別`EMERGENCY_STOCK`）**で、中身は普通の`StockLot`。
  防災用の別在庫は作らない。新しいモデル（`DisasterBag`）が足すのは「点検の単位として見るときの
  目標」だけで、バッグそのものではない
- **バッグの目標は家庭全体（既定2人・3日）とは別に持つ**（既定1人・1日・180日ごとに点検）。
  持ち出し袋に家全体の3日ぶんを求めるとどのバッグも常に不足になり、点検の役に立たない。
  重ねるのは**人数と日数だけ**で、1人1日あたりの必要量も「冷蔵を数えるか」も家庭の基準を使う
  （`bag.ts`の`toBagPlan()`）。バッグごとに変えられるようにすると、同じ在庫が置き場所で
  違う扱いになる
- **数える範囲はバッグの中身だが、熱源と飲料水の有無は家庭全体で見る。**
  `assessDisasterStock()`は既定で「渡された在庫」から供給を出すため、バッグに絞ったまま呼ぶと
  家にカセットボンベがあってもバッグの中のカップ麺が「熱源がない」で落ちる。
  `resolveAvailability()`を家庭全体の在庫に対して呼び、第4引数で渡す（#8の計画レビューでの指摘）。
  **在庫の一部だけを渡して判定するときは必ずこの形にする**
- **バッグの画面に全体の備蓄日数（`assessment.coverageDays`）を出さない。** バッグに食料や水が
  入っていなければ0日になり、家全体の備えとして読み違えられる。出すのは区分ごとの充足率・不足量まで
- **「手当てが要るもの」は充足の除外理由とは別の観点**（`bag.ts`の`attentionOf()`）。除外理由は
  「非常時に数えられるか」、点検は「いま人が手を入れるべきか」を答える。期限間近は算入されるが
  点検では入れ替えの対象に出す。**1件につき理由は1つだけ**にする（2か所で数えると合計が中身の
  件数を超えて読めなくなる）。**0件の観点も畳まない**——見ていないのか0件だったのかを分けるため
- **点検の記録（`DisasterBagInspection`）は「人が見た」ことの記録で、充足の判定結果は保存しない**
  （#7の方針どおり）。件数だけは点検時点の状態として残す（後から再計算では出せないため）。
  **件数は保存の直前に数え直す**——画面を開いてから記録するまでに在庫が動くため
- **未点検（`NEVER`）と期限切れ（`OVERDUE`）を分ける。** 「まだ始めていない」と「期限を過ぎた」では
  次にやることが違う。次回の予定日は最終点検日＋間隔で、**日付の加算は日本時間の通し番号の上で行う**
  （`bag.ts`の`nextInspectionDueOn()`。`Date`のミリ秒に日数を足すと、期限の列と同じUTC0時に戻らない）
- **不足は色だけで表さない。** 充足率（%）・「不足／充足」の語・記号を必ず併記し、バーの足りない
  部分は斜線にする（`coverage-summary.tsx`の`CoverageBar`）。受入条件の「色だけに依存せず
  不足を表現する」はこの形で満たす

## 画面の行き先（ナビ）

行き先の定義は`src/components/inventory/nav-items.ts`が正本で、`app-nav.tsx`（`"use client"`）
と`/menu`のページがそれを読む。

- **`"use client"`のファイルから配列をexportしてサーバーコンポーネントで使わない。**
  クライアント参照のプロキシになり、`OVERFLOW_ITEMS.map is not a function`で落ちる。
  画面から読むデータは素のモジュール（`nav-items.ts`）へ置く
- **スマホの下タブは「メニュー」を含めて5つで打ち止め。** 画面幅を等分するため、増やすほど
  1つずつ細くなって押し分けられなくなる。`ITEMS`へ足しただけの行き先は自動的に
  `/menu`側へ回るので、**下タブへ入れたい場合は代わりに何を外すかを決める**。
  PC・iPadの左ナビは縦に伸びるだけなので全項目を並べる
- **下タブに残すのは、スマホでしかできないことと毎日触るもの**（いまは在庫・読取・期限・履歴）。
  バーコード読取は`navigator.mediaDevices`がhttpsかlocalhostでしか生えず**実質スマホ専用の
  入力導線**なので下タブに残す（PCでは左ナビにあるため、外すとカメラを使える側だけが1段深くなる）。
  防災は読むための集計画面で毎日押すものではないので`/menu`側に置く
- **現在地は「前方一致の長いもの」で選ぶ。** `/inventory/scan`は`/inventory`の下にあるため、
  単純な先頭一致だと読取の画面で「在庫」が光る（`nav-items.ts`の`matches`）

## 期限と通知

期限の判定（#5）は次の3点が前提。

- **「今日」は日本時間で決める**（`src/lib/time/tokyo.ts`）。期限の列はMySQLの`DATE`で、Prismaは
  UTC0時の`Date`として返す。ここでUTC基準に数えると**JSTの0時〜9時のあいだだけ判定が1日ずれる**
  （朝8時に開くと、今日切れる在庫が「今日まで」のままになる）。日付の引き算は`tokyoDaysBetween()`を通す。
  日付の列も時刻を持つ値も同じ関数で扱える（UTC0時 + 9時間は同じ日の朝9時なので日付が変わらない）
- **期限が入っていない在庫は`UNKNOWN`（要確認）で、`FINE`（期限内）に混ぜない。** 混ぜると、期限を
  入れ忘れた在庫が「期限内」として数えられ、そのまま古くなる。件数（`summarizeExpiry()`）でも
  絞り込み（`?expiry=unknown`）でも独立して数える
- **接近日数は賞味期限と消費期限で別に持つ**（既定7日・3日。`ExpirySetting`）。設定が無い家庭は
  `DEFAULT_EXPIRY_POLICY`で動くので、家庭を作るたびに設定行を用意しなくてよい

通知は`src/lib/notifications/`。

- **重複防止は専用のフラグを持たず、`@@unique([householdId, channel, dedupeKey])`で行う**
  （在庫の二重送信対策と同じ考え方）。2回目のINSERTは弾かれるので、そのとき既存行の
  `suppressedCount`を増やす。「送らなかったこと」も記録に残す
- **dedupeKeyに日付を入れない。** 対象ロットと状態（`lotId:status`）の指紋から作るため、状況が
  変わらないかぎり何度実行しても届かず、期限間近→期限切れのように**変わったときだけ**もう一度届く。
  日付を入れると毎日必ず鳴り、ロットidだけにすると状態が変わっても鳴らない
- **送信に失敗した行は`dedupeKey`を`failed:<id>`へ退避する。** そのまま残すと次回が「送信済み」と
  見なされ、永久に届かない
- **`channels.ts`・`service.ts`・`expiry-job.ts`では`@/`エイリアスを使わない。** `pnpm job:expiry`が
  `node`から直接読むため（seed.tsと同じ制約）。PrismaClientは引数で受け取る。
  画面から呼ぶ読み取り（`inbox.ts`）は`scopeToHousehold()`を通す通常の画面用モジュール
- 送り先は`STOCKLY_NOTIFY_CHANNELS`（既定は`IN_APP`）。メール・LINE等の外部サービスは未実装で、
  追加にはユーザー確認が要る。**定期実行（cron）の登録はVPS側の手作業**で、このリポジトリには入っていない

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
- **自分のオリジンは`getRequestOrigin()`だけで組み、`X-Forwarded-Proto`を鵜呑みにしない**（#34）。
  certbotは`:80`のVirtualHostを丸ごと`:443`へ複製するため、TLSを終端していても
  `RequestHeader set X-Forwarded-Proto "http"`が残ることがある。ヘッダーどおりに組むと
  OAuthの`redirect_to`が`http://stockly.gucchii.com/auth/callback`になり、SupabaseのRedirect URLs
  （`https://`で登録）と一致せず、**認証後にSite URL（`https://gucchii.com`）へ飛ばされる**。
  `getRequestOrigin()`はローカル開発のホスト名（localhost・生IP・sslip.io）以外を`https`に固定する
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

