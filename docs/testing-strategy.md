# テスト戦略と検証基準

**いつ読むか**: 機能Issueを実装してPull Requestを出す前。「このIssueにはどのテストを同梱すべきか」
「越境・入力検証・CSRFなどの検証はどこで担保されているか」を確かめるとき。
CIの構成を変えるとき。

Stocklyの品質基盤（#13）。認証・在庫履歴・AI候補・Notion連携は失敗モードが違うため、
まとめて最後に検証するのではなく、**各Issueが自分の変更に対応するテストを同梱する**ことを前提にする。
コマンドと実行順は[CLAUDE.md](../CLAUDE.md)の「検証」を正とし、ここでは「何をどの層で確かめるか」を決める。

## 1. テストの層と責務

| 層 | 場所・コマンド | 接続先 | 何を確かめるか | 実行タイミング |
| --- | --- | --- | --- | --- |
| unit | `src/**/*.test.ts` / `pnpm test:unit` | なし（DB・外部サービスに接続しない） | 純関数の振る舞い。数量計算・単位換算・入力の読み取り・家庭境界の判定・許可メール・戻り先の正規化・開発用ログインの無効化 | 毎PR。CI `lint-and-build`の必須チェック |
| db（統合） | `db-tests/**/*.test.ts` / `pnpm test:db` | 実DB（MySQL/MariaDB） | **DB制約そのもの**。複合外部キーによる越境の拒否、二重取消の拒否、集計値と履歴の一致、履歴からの再構築 | 毎PR。CI `db-constraint-tests`（必須チェックではない。理由は§5） |
| smoke（本番起動） | `scripts/check-dev-login-disabled.sh` | なし | 本番ビルドを実際に起動し、開発用ログインが閉じていること・未ログインが`/login`へ戻ることをHTTPで確認 | 毎PR。CI `lint-and-build`のビルド直後 |
| E2E（ブラウザ） | 自動化はまだ無い。`pnpm dev` + 開発用ログイン（`POST /api/dev/login`）+ `curl`で画面確認 | ローカルDB | 画面の導線・フォーム・リダイレクト。結果はPR本文の「確認方法」に手順として残す | 挙動が変わるPR。Playwright等の導入はユーザー確認が要る（トークン消費が大きい） |

**層をまたがない。** unitからDBへ接続しない（`pnpm test:unit`はDBの無いCIで動く）。
db-testsからNext.jsの`@/`エイリアスは解決できない（`node --test`はtsconfigのpathsを読まない）ので、
`../src/lib/...ts`の相対パスで純関数・`rebuild.ts`のようにPrismaクライアントを引数で受け取る関数だけを呼ぶ。
`service.ts`（`@/lib/db`に依存）はdb-testsから直接呼べない。サービス層の振る舞いは、純関数へ切り出した部分を
unitで、DB制約をdbで、それぞれ確かめる。

Nodeはstrip-onlyモードでTSを実行するため、テストとそこから読むモジュールでは`enum`・`namespace`・
パラメータプロパティを使わない（[CLAUDE.md](../CLAUDE.md)「検証」）。

## 2. 機能領域ごとに同梱すべきテスト

各機能IssueのPull Requestは、触った領域の行にある「必ず」を満たす。満たせない場合は理由をPR本文に書く。

| 領域 | 必ず | あれば望ましい | 対応Issue |
| --- | --- | --- | --- |
| 認証・利用可否（`src/lib/auth/`, `src/proxy.ts`） | unit: 許可メールのfail-closed、戻り先の正規化、開発用ログインの二重無効化。smoke: 本番起動で`/api/dev/login`が404 | 公開パスの一覧（`PUBLIC_PATHS`）を変えたら、未ログインで到達できるパスの一覧をPR本文に書く | #2, #34, #13 |
| 家庭の境界（`src/lib/household/`, スキーマ） | unit: `scopeToHousehold()`が他家庭のidを受け付けない。db: **新しいモデルを足したら**、そのモデルへ他家庭の親を参照させるINSERTが外部キーで弾かれるテストを`db-tests/household-boundary.test.ts`へ1件足す | — | #2, #3, #18 |
| 在庫履歴（`src/lib/inventory/`） | unit: 種別と符号、取消の組み立て、数量の状態遷移。db: 集計値と履歴の一致（seed）、二重取消の拒否、再構築 | 新しい`InventoryTransactionType`を足したら、その符号の規則を`ledger.test.ts`へ | #3, #4, #13 |
| 期限・通知（#5） | unit: Asia/Tokyoの日付境界、期限不明を期限内とみなさない、重複通知のdedupeKey | db: 重複通知を防ぐ一意制約 | #5 |
| 防災ストックの判定（#7） | unit: 区分と必要量の算出、冷蔵冷凍・期限切れ・期限不明・開封済み・換算不能を数えないこと、明示設定を立てたときだけ例外化されること、同じ入力なら同じ結果になること。db: `DisasterPlanSetting`の既定値がコード側の`DEFAULT_DISASTER_PLAN`と一致すること | 区分・必要量の意味・除外条件を変えたら`DISASTER_RULE_VERSION`を上げ、その版で判定した結果が画面から追えることを確かめる | #7 |
| 補充・Notion連携（#6） | unit: 不足量の算出、再送でNotion側が重複しないidempotencyキーの組み立て。**Notion APIへは接続しない**（クライアントを差し替えられる形にし、送信内容の組み立てを純関数で検証する） | 接続失敗時に在庫更新をロールバックせず再送可能な状態を残すことの検証 | #6 |
| バーコード・商品マスタ（#9） | unit: コードの正規化と重複検知、確定済みルール > バーコード > AI候補の優先順位 | db: `Barcode`の`@@unique([householdId, code])` | #9 |
| AI候補（#10, #11） | unit: 候補の信頼度の閾値と「自動確定しない」こと、確定前後の状態遷移。**モデルAPIへは接続しない**（応答を固定した入力で検証する） | 画像を扱う場合は§3の「画像アップロード制約」を満たすテスト | #10, #11 |
| 権限・共有（#12） | unit: OWNERだけができる操作をMEMBERが呼べないこと。db: `HouseholdMember`の`@@unique([householdId, userId])` | 招待の受け入れで他家庭へ所属しないこと | #12 |

**PR本文に書くこと**: 追加・変更したテストの一覧（ファイル名）と、自動テストで確かめられなかった挙動を
どう手で確認したか（開発サーバーのURLと手順）。

## 3. セキュリティ検証の一覧

「何で守っているか」と「どう確かめているか」を分けて書く。**検証手段が「なし」の行は、
その機能を実装するIssueが検証を足す。**

| 項目 | 守っている場所 | 検証手段 | 状態 |
| --- | --- | --- | --- |
| 家庭の越境（他家庭の在庫を読む・書く） | アプリ: `scopeToHousehold()`（`src/lib/household/access.ts`）。在庫の読み書きは`service.ts`・`queries.ts`だけが行い、その`householdId`だけをwhereに使う。DB: 全モデルの`[householdId, 親Id]`複合外部キー | unit: `access.test.ts`。db: `household-boundary.test.ts`（StockLot・InventoryTransactionの越境INSERTが弾かれる） | 担保あり |
| IDOR（URLやフォームのidを他家庭のものに差し替える） | 画面から渡るid（lotId・transactionId・storageLocationId）は必ず`{ id, householdId }`の組で引く（`service.ts`の`loadLotForUpdate()`等）。見つからなければ`InventoryNotFoundError` | 上と同じ。加えて、新しい画面で`db.<model>.findUnique({ where: { id } })`のように`householdId`無しで引いていないことをレビューで見る | 担保あり |
| 権限変更（OWNER/MEMBER） | 役割はスキーマにあるが、役割で分ける操作はまだ無い（所属の有無だけで判定） | なし（#12が、役割で分ける操作を足すときにunitテストを同梱する） | #12で実装 |
| 入力検証 | Server Actionは`operations.ts`の`parse*()`を通してからserviceを呼ぶ。数量は`Prisma.Decimal`・桁数はDBの`Decimal(14,3)`に合わせて拒否、日付は存在確認、操作IDは形式確認 | unit: `operations.test.ts` | 担保あり |
| CSRF | Server ActionはNext.jsが`Origin`と`Host`の一致を検証する（不一致は拒否）。Route Handlerの`POST`は`/api/dev/login`（本番404）と`/auth/signout`（ログアウトのみ）。セッションCookieは`SameSite=Lax` | smoke: 本番起動で`/api/dev/login`が404。Route HandlerでPOSTを足すときは、状態を変えるものをServer Actionへ寄せるか、Originの検証を足してPR本文に書く | 担保あり（Route Handler追加時に再確認） |
| rate limit | なし。ログインはSupabase Authのレート制限に依存。アプリ側のServer Action・APIには無い | なし | 別Issueで対応（起点 #13）。少なくとも認証まわりの公開パス（`/auth/*`、将来のAPI）を対象にする |
| 画像アップロード制約 | まだ画像を受け取る機能が無い | なし（#10・#11が実装するときの基準は下記） | #10・#11で実装 |
| 開発用ログインの本番無効化 | `isDevLoginEnabled()`が`NODE_ENV=production`とシークレット未設定の二重で偽 | unit: `dev-login.test.ts`。smoke: `scripts/check-dev-login-disabled.sh`（シークレットをわざと与えて起動し、404とリダイレクトを確認） | 担保あり |
| シークレット・個人情報の混入 | `.env.local`はgit管理外。`ALLOWED_GOOGLE_EMAILS`等の実値はGitHub Secrets/1Passwordのみ | レビューで見る。`.env.example`は空値のみ | 運用で担保 |

### 画像アップロード制約の基準（#10・#11向け）

- 受け付ける形式は`image/jpeg`・`image/png`・`image/webp`・`image/heic`に限り、**MIMEタイプはクライアントの申告ではなくサーバー側でマジックバイトを見て判定する**
- 1枚あたりの上限は10MB、1リクエストあたりの枚数上限を決めて`parse*()`と同じ層で拒否する
- 画像本体はDBに入れない。AI候補の抽出に使ったあとは保持しない（保持が要る場合は保存先・期限・費用をユーザー確認のうえ決める）
- 位置情報（EXIF GPS）はモデルへ送る前に落とす
- 候補の抽出結果（テキスト）だけを`ProductAlias`等に残し、`confidence`を付ける。**自動確定はしない**（README「プロダクト方針」）
- unitテスト: 形式判定・サイズ上限・枚数上限の境界値。モデルAPIには接続せず、応答を固定した入力で確定前後の状態を検証する

## 4. 操作の追跡（監査）について

専用の監査ログテーブル・画面は**持たない**（個人利用のアプリには過剰、#13の計画レビューでの判断）。
操作の追跡は、append-onlyの`InventoryTransaction`が担う。

- 誰が（`memberId`）・いつ（`recordedAt`／`occurredAt`）・どのロットに（`stockLotId`）・何をしたか（`type`・`quantityDelta`）が1行ずつ残り、UPDATE/DELETEは行わない（取消は`REVERSAL`行の追加）
- 履歴画面（`/history`）で家庭のメンバー全員が見られる
- AI確定・Notion送信・権限変更のような**在庫数量を変えない操作**を後から追跡したくなった場合は、そのIssueで
  「何を残すか（secret・画像本文・不要な個人情報は残さない）」を決めてから、専用のテーブルを検討する。
  `InventoryTransaction`へ列を足して兼ねることはしない（業務履歴の意味が濁る）

## 5. CIで必須にしているもの・していないもの

- **必須チェック（branch protection）は`lint-and-build`のみ。** 中身は`pnpm lint` → `pnpm typecheck` → `pnpm test:unit` → `pnpm build:ci` → `bash scripts/check-dev-login-disabled.sh`（本番起動スモーク）
- `db-constraint-tests`（`pnpm test:db`。MySQL 8のサービスコンテナ）は毎PRで動くが**必須にしていない**。
  無人修復ワークフロー（`claude-ci-fix.yml`・`claude-pr-repair.yml`）が実DBを持たず、このジョブの失敗を確かめながら
  直せないため。落ちたときは人（またはローカルセッション）が`pnpm test:db`で確かめて直す。
  **落ちたまま放置してよいという意味ではない**——Signalyへ失敗が通知される
- `lint-and-build`のステップを増やしたら、`claude-ci-fix.yml`・`claude-pr-repair.yml`の`verify-commands`を同じ内容に直す（[CLAUDE.md](../CLAUDE.md)「検証」）
- 外部キー違反のエラーコードはサーバーのビルドによって1452（→ Prismaの`P2003`）と1216
  （→ `PrismaClientUnknownRequestError`）に分かれる。**拒否されることを`P2003`だけで判定しない**
  （#44・#9。詳細と使う関数は[CLAUDE.md](../CLAUDE.md)「検証」）。**これはMariaDBだけの話ではなく、
  手元のMySQL 8.0.46でも1216が返る**——`db-tests/replenishment-boundary.test.ts`はこの形で落ちており、
  #7で`assertRejectedByDatabase()`へ揃えた。新しいdb-testを書くときは、はじめから
  `assertRejectedByDatabase()`か`isForeignKeyViolation()`を使い、`P2003`を直接見ない
- **サブPCのローカルDBはMySQL 8**（`mysql -u stockly -p -e 'select @@version'`で確認できる）。
  本番（VPS）は共有MariaDBなので、**MariaDB固有の挙動は手元では再現できない**。
  DBの実装差に依存しないテストの書き方（上）で回避する

## 6. 復元・再構築の検証

障害時に履歴から現在庫を組み立て直す手順は[backup-restore.md](backup-restore.md)にあり、
その手順が実際に動くことは`db-tests/rebuild-quantities.test.ts`が毎PRで確かめる
（集計値をわざと壊して`rebuildLotQuantities()`で戻す）。
