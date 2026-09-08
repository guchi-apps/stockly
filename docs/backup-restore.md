# バックアップと復元

**いつ読むか**: 本番DB（`app_stockly`）を壊した・消した・戻したいとき。バックアップの頻度や保持期間を
変えたいとき。定期のrestore testを行うとき。在庫の数量が履歴と合わなくなったとき。

Stocklyの在庫データの正本はMariaDBの`app_stockly`（[CLAUDE.md](../CLAUDE.md)「データモデル」）。
バックアップの**実体はVPS側の共通仕組み**（`guchi-apps/vps`）にあり、このリポジトリは
「Stocklyとしてどう復元し、何を確かめるか」を持つ。VPS側の設定を変える場合は`guchi-apps/vps`へIssueを立てる。

## 1. バックアップの現状（VPS共通）

| 項目 | 現状 | 出典 |
| --- | --- | --- |
| 方式 | `mysqldump --all-databases`をgzip圧縮。全アプリのDBを1ファイルに含む | `guchi-apps/vps` `scripts/backup-mysql.sh` |
| 頻度 | 毎日 03:00（cron） | `guchi-apps/vps` `cron/crontab.txt` |
| 保存先 | VPSローカル `/var/backups/mysql/all-databases-YYYYMMDD.sql.gz` と、オフサイトとしてGoogle Drive（rclone、リモート`gdrive:mysql-backup/`） | `guchi-apps/vps` `docs/backup.md` |
| 保持期間 | 30日（ローカル・オフサイトとも） | 同上 |
| 暗号化 | **なし**（gzip圧縮のみ。Google Drive側の保存時暗号化には依存するが、クライアント側では暗号化していない） | 同上 |
| 通知 | 成功・失敗ともSignaly | 同上 |
| RPO（失いうるデータ） | 最大24時間ぶんの在庫操作 | 頻度から |

### 決定待ちの事項

以下は費用・保存先・secretに関わるため、**ユーザー確認のうえで決める**（#13の技術上の前提）。決まるまでは現状維持。

| 事項 | 推奨案 | 影響 |
| --- | --- | --- |
| クライアント側の暗号化 | `age`（または`gpg`）でダンプを暗号化してからrcloneでアップロードする。鍵は1Passwordに置き、VPS上の秘密鍵はgit管理外 | Google Driveに平文の全DBダンプ（他アプリの個人データも含む）が置かれている状態を解消できる。復元時に鍵が要る（鍵を失うとバックアップが読めない） |
| restore testの定期化 | 四半期に1回、§4の手順を手で実施して結果を`guchi-apps/vps`のIssueに残す。自動化は後回し | 「バックアップが取れている」と「戻せる」は別。実際に戻して初めて確かめられる |
| 保持期間 | 30日のまま | 在庫データは日次で更新され、30日より古い状態へ戻す需要は低い |

いずれも変更先は`guchi-apps/vps`（バックアップスクリプト・cron）で、このリポジトリでは変更しない。

## 2. 復元手順（Stocklyだけを戻す）

ダンプは全アプリのDBを1ファイルに含む。**`sudo mysql < all-databases.sql`で丸ごと戻すと他アプリのDBも
その日の状態へ巻き戻る**ため、Stocklyだけ戻すときは`app_stockly`の部分を切り出す。

作業はVPS上（`~/.my.cnf`でroot接続できる前提）。日付は戻したい日のもの。

```bash
# 1. バックアップを取り出す（ローカルに残っていればそれを使う。無ければGoogle Driveから）
sudo rclone copy gdrive:mysql-backup/all-databases-YYYYMMDD.sql.gz /tmp/
gunzip -k /tmp/all-databases-YYYYMMDD.sql.gz

# 2. app_stockly の部分だけを切り出す（mysqldumpは "-- Current Database: `<名前>`" で区切る）
sed -n '/^-- Current Database: `app_stockly`$/,/^-- Current Database: `/p' /tmp/all-databases-YYYYMMDD.sql \
  | sed '$d' > /tmp/app_stockly-YYYYMMDD.sql
grep -c '^CREATE TABLE' /tmp/app_stockly-YYYYMMDD.sql   # テーブル数が出れば切り出せている

# 3. アプリを止める（復元中に書き込ませない）
pm2 stop stockly

# 4. 現状を退避してから戻す（戻した結果が悪ければ退避から戻せる）
mysqldump app_stockly | gzip > /tmp/app_stockly-before-restore-$(date +%Y%m%d%H%M).sql.gz
mysql app_stockly < /tmp/app_stockly-YYYYMMDD.sql

# 5. スキーマをコードに合わせる（バックアップ以後にマイグレーションが入っていれば適用される）
cd <TARGET_DIR> && DATABASE_URL="$MIGRATE_DATABASE_URL" pnpm exec prisma migrate deploy

# 6. 起動して確認
pm2 start stockly
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3116/login   # 200
```

`TARGET_DIR`と`MIGRATE_DATABASE_URL`はデプロイが`.env`へ書いた値（[CLAUDE.md](../CLAUDE.md)「本番デプロイ」）。

## 3. 復元後の確認（必ず行う）

戻ったかどうかは、画面が開くことではなく**数量が履歴と合っているか**で判定する。

```bash
cd <TARGET_DIR>
pnpm db:rebuild-quantities            # dry-run。ずれが0件なら終了コード0
```

- `n件ずれ`が出たら§5で直す。ダンプの途中でトランザクションが切れることはない（mysqldumpは
  `--single-transaction`が無くても各テーブルをロックして取るため）が、復元先に**別の時点の行が混ざった**場合
  （途中で失敗して部分的に流れた等）はずれる
- `照合不能`が出たら、単位の換算ができない履歴が混ざっている。ロットのidが出るので、履歴を見て手で判断する
- ログインし、在庫一覧・履歴が復元した日付の状態で出ることを目で確かめる

## 4. restore test（定期）

「戻せること」を、本番を触らずに確かめる。ローカル（subpc）で行う。**四半期に1回**を目安とし、
結果（実施日・使ったダンプの日付・ずれの件数）を`guchi-apps/vps`のIssueに残す（周期はユーザー確認のうえ決める。§1）。

```bash
# 1. VPSから直近のダンプを持ってくる（scpでもrcloneでもよい）
scp <vps>:/var/backups/mysql/all-databases-YYYYMMDD.sql.gz /tmp/

# 2. Stocklyの部分を切り出す（§2の手順2と同じ）
gunzip -k /tmp/all-databases-YYYYMMDD.sql.gz
sed -n '/^-- Current Database: `app_stockly`$/,/^-- Current Database: `/p' /tmp/all-databases-YYYYMMDD.sql \
  | sed '$d' > /tmp/app_stockly-YYYYMMDD.sql

# 3. 検証用のDBへ流す（開発用DBとは別名にする）
mysql -u stockly -p -h 127.0.0.1 -e 'CREATE DATABASE IF NOT EXISTS app_stockly_restore_test CHARACTER SET utf8mb4'
mysql -u stockly -p -h 127.0.0.1 app_stockly_restore_test < /tmp/app_stockly-YYYYMMDD.sql

# 4. コードのスキーマまで上げ、数量と履歴の整合を確かめる
DATABASE_URL='mysql://stockly:<pw>@127.0.0.1:3306/app_stockly_restore_test' pnpm db:migrate:deploy
DATABASE_URL='mysql://stockly:<pw>@127.0.0.1:3306/app_stockly_restore_test' pnpm db:rebuild-quantities

# 5. 片付け（本番の個人データを含むため、確認が済んだら消す）
mysql -u stockly -p -h 127.0.0.1 -e 'DROP DATABASE app_stockly_restore_test'
rm /tmp/all-databases-YYYYMMDD.sql* /tmp/app_stockly-YYYYMMDD.sql
```

`pnpm db:rebuild-quantities`が終了コード0（ずれ0件・照合不能0件）で、テーブル数と在庫の件数が想定どおりなら合格。
ダンプが読めない・切り出せない・マイグレーションが当たらない、のどれかが起きたら、その時点で
バックアップは「戻せない」状態なので、`guchi-apps/vps`へIssueを立てる。

## 5. 履歴から現在庫を再構築する

`StockLot.quantity`は集計値で、正本は`InventoryTransaction`（append-only）。日常の操作は
`service.ts`が同じトランザクションで両方を更新するが、復元の失敗・直接SQLでの誤操作・バグで
集計値だけがずれることがある。そのときは履歴の合計へ戻す。

```bash
pnpm db:rebuild-quantities                       # 一覧するだけ（DBを変えない）
pnpm db:rebuild-quantities -- --apply            # ずれたロットの quantity と status を履歴の合計へ戻す
pnpm db:rebuild-quantities -- --household <id>   # 1家庭に絞る（--apply と併用できる）
```

- **履歴は書き換えない。** 直すのは`StockLot.quantity`と、それに従う`status`だけ
  （0なら`DEPLETED`、廃棄済みなら`DISCARDED`、負のロットは`ACTIVE`のまま。取消で0を割った場合と同じ規則）
- 本番で流すときは先に`pm2 stop stockly`で書き込みを止める。稼働中に流しても壊れはしないが、
  流している最中の記録と競合したロットは次のdry-runで再びずれとして出る
- 実装は`src/lib/inventory/rebuild.ts`（判定は`ledger.ts`の`verifyLotQuantity()`に任せている）。
  手順が動くことは`db-tests/rebuild-quantities.test.ts`が毎PRで確かめる

## 6. 関連

- CI・テストの層と検証項目: [testing-strategy.md](testing-strategy.md)
- VPS側のバックアップ設定: `guchi-apps/vps` `docs/backup.md`・`scripts/backup-mysql.sh`
- 起点Issue: #13
