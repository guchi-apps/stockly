# Stockly の撤去手順

**このアプリは運用を終了し、リポジトリをアーカイブする。** 本書は停止・撤去の順序とStockly固有の
対象をまとめた正本で、起点は #158。共通の順序と落とし穴は guchi-apps/issue-deck の
`docs/app-shutdown.md` を参照する（同じ手順を2か所に持たないため、ここには差分だけを書く）。

アーカイブ後も本書は読めるので、途中で中断してもどこまで進んだかを判定できる。

## なぜ撤去してよいと判断したか（2026-10-31時点の調査）

`gh search code --owner guchi-apps stockly` で他リポジトリの参照を横断し、各参照の中身を確かめた。
**StocklyのAPI（`/api/*`）を呼んでいる他アプリは無い。** 外への通信はStocklyから出るもの
（Notion・Anthropic）だけで、どちらもStocklyを止めれば発生しなくなる。

| 参照元 | 実態 | 撤去の影響 |
|---|---|---|
| `guchi-apps/vps` `apache/sites-available/stockly.gucchii.com{,-le-ssl}.conf` | 本番の公開経路（→ `127.0.0.1:3116`） | 消し込みが必要（実機とリポジトリの両方） |
| `guchi-apps/vps` `README.md` | アプリ一覧の1行 | 台帳の消し込みのみ |
| `guchi-apps/vps` `cron/crontab.txt` | **Stocklyの行は無い**（期限通知 `pnpm job:expiry` は未登録のまま） | 無し |
| `guchi-apps/status-hub` `src/lib/ai-app-usage/purposes.ts`・`README.md` | AI使用量の用途一覧に載っているだけ（「未連携」扱いで、値は取りに来ていない） | 台帳の消し込みのみ |
| `guchi-apps/docs` `inventory/1password-apps.md`・`knowledge/*.md` | 台帳と、事例としての言及 | 台帳の行は消す。知見の事例としての言及は残してよい |
| `guchi-apps/issue-deck` `docs/*.md` | 展開記録・レビュー記録での言及 | 対応リポジトリ台帳・ポート帯などを`運用終了`へ |
| Notion 買い物リスト | Stocklyから補充候補を書き込むだけ（読み戻さない） | 送信済みの項目はNotion側に残る。Notionが正本なので消さない |
| Anthropic API | 写真からの登録・減算候補で呼ぶだけ | 止めれば呼ばれない。本番の資格情報はVPSの`.env`にあり置き場ごと消えるが、キーやOAuthトークン自体は失効しないので、Stockly専用に発行したものならAnthropic側でも無効化する |

## このアプリ固有の事情

| 項目 | 値 |
|---|---|
| 公開URL | `https://stockly.gucchii.com/` |
| PM2のプロセス名 | `stockly`（待受 `127.0.0.1:3116`） |
| VPSの置き場 | `/home/github-user/apps/stockly`（app-deploy-gateが固定。`TARGET_DIR`はもう使っていない） |
| DB | `app_stockly`（共有MariaDB） |
| デプロイ用の鍵 | `/home/github-user/.ssh/authorized_keys` の `command="/usr/local/sbin/app-deploy-gate stockly"` の行（`deploy-stockly`）。リポジトリ管理外 |
| GitHub Secrets（repository） | `ALLOWED_GOOGLE_EMAILS`・`DB_NAME`・`NOTION_API_TOKEN`・`NOTION_SHOPPING_DATABASE_ID`・`SSH_PRIVATE_KEY`・`TARGET_DIR`（variablesは無し） |
| 1Password | `apps/stockly` をアーカイブへ移す。`apps/Anthropic` は名前が汎用で今後も使いうるため触らない（参照はStocklyの`ANTHROPIC_API_KEY`だけだが、`api-key`のフィールドは作られておらず、GitHub Secretにも同期されていない） |

- **本番DBには家庭の在庫・履歴の実データが入っている。** DROPの前に必ず`mysqldump`で控える。
  ダンプには家庭の個人情報が入るので、リポジトリやIssueに置かない
- **Notionのインテグレーション（`NOTION_API_TOKEN`）はStockly専用。** GitHub Secretを消すだけでは
  トークン自体は有効なまま残るので、Notionの「インテグレーション」画面から削除（失効）する
- **Supabaseに消すものは無い。** プロジェクトは他アプリと共有で、Redirect URLsはワイルドカード登録
- 期限通知のcronは一度も登録していないため、止めるものは無い（`guchi-apps/vps`の`cron/crontab.txt`にstocklyの行が無いことを2026-10-31に確認）

## 停止後のGitHub Actionsの扱い

本番へ届く経路は`deploy.yml`だけなので、止めるのはそれだけにした。残りはアーカイブで一斉に止まる。

| ワークフロー | 扱い | 理由 |
|---|---|---|
| `deploy.yml` | `on:`を`workflow_call:`だけにした | **ファイルも`on:`も消さない。** `push: main`だけを外すとissue-deckが配送漏れとみなして`workflow_dispatch`で起動し直す（残っていれば本番へ配られる）。`workflow_dispatch`も無ければ再起動は422になり、issue-deckは「起動できないリポジトリ」として静かに畳む。ファイルごと消すとこの静かな経路から外れる。`src/deploy-workflow.test.ts`がこの形を確かめる |
| `deploy-retry.yml` | そのまま | `deploy.yml`の完了でしか起動しないので、もう発火しない（issue-deckの`docs/app-shutdown.md`も個別に止めなくてよいとしている） |
| `release-develop-to-main.yml`・`version-tag-check.yml` | そのまま | 起動は`develop`への`package.json`のpush・手動・main宛PRだけ。リリースPRが作られてmainへ入っても`deploy.yml`が起動しないため本番へは届かない（タグとReleaseも作られない） |
| `claude-*`（dispatch・CI修復・レビュー等） | そのまま | 運用終了後に残るIssueは撤去の手作業と台帳の消し込みだけ。アーカイブで止まる |

## 撤去の順序

1. 本番デプロイを止める — `.github/workflows/deploy.yml` の `on:` を `workflow_call` だけにした（#158）。
   `develop`→`main`のリリースは不要（アーカイブ後はActionsが動かず、`main`側も起動しない）
2. 外形監視（Uptime Kuma）から `stockly.gucchii.com` のモニターを外す
3. VPSから撤去（PM2の削除・DBのダンプとDROP・置き場の削除・デプロイ鍵の行の削除・
   Apacheの無効化・certbot・DNSのAレコード削除）。Apacheの設定ファイルは `guchi-apps/vps` からも消す
4. シークレットの後片付け（GitHub Secrets・1Password `apps/stockly`・Notionのインテグレーション）
5. 台帳の更新（issue-deck・`guchi-apps/vps`・`guchi-apps/docs`・`guchi-apps/status-hub`）
6. リポジトリのアーカイブ（**最後**）→ issue-deckの「リポジトリを再同期」

手作業と台帳の消し込みは、#158 から切り出したIssueで進める。

## VPSでのコマンド（Stocklyの値で埋めたもの）

```bash
# （VPS・sudo不要）PM2から外す
pm2 delete stockly
pm2 save

# （VPS・パスワードを対話で聞かれる）DBを控えてから落とす
mysqldump -u root -p app_stockly > ~/app_stockly-$(date +%Y%m%d).sql
mysql -u root -p -e "DROP DATABASE app_stockly;"

# （VPS・sudo不要）置き場を消す（.envに実シークレットが入っている）
rm -rf /home/github-user/apps/stockly
# authorized_keys から app-deploy-gate stockly の行を消す
sed -i.bak '/app-deploy-gate stockly"/d' /home/github-user/.ssh/authorized_keys

# （VPS・sudo）Apacheと証明書。DNSのAレコードはこの後で消す
sudo a2dissite stockly.gucchii.com stockly.gucchii.com-le-ssl
sudo rm -f /etc/apache2/sites-available/stockly.gucchii.com.conf \
           /etc/apache2/sites-available/stockly.gucchii.com-le-ssl.conf
sudo apache2ctl configtest && sudo systemctl reload apache2
sudo certbot delete --cert-name stockly.gucchii.com
```

```bash
# （サブPC）GitHub Secretsを消す。アーカイブすると消せなくなるので、アーカイブより前に行う
for k in ALLOWED_GOOGLE_EMAILS DB_NAME NOTION_API_TOKEN NOTION_SHOPPING_DATABASE_ID SSH_PRIVATE_KEY TARGET_DIR; do
  gh secret delete "$k" --repo guchi-apps/stockly
done

# （サブPC）1Passwordのアイテムをアーカイブへ移す（apps/Anthropic は触らない）
op item delete "stockly" --vault apps --archive

# 最後にアーカイブ
gh repo archive guchi-apps/stockly
```

## 完了の確認

```bash
# 本番デプロイに起動できるトリガーが無いこと（`workflow_call:` だけが出れば完了）
sed -n '/^on:/,/^$/p' .github/workflows/deploy.yml

# 公開が止まっていること
curl -sS -o /dev/null -w '%{http_code}\n' -m 10 https://stockly.gucchii.com/ || echo "到達不可（期待どおり）"

# DNSが引けないこと（何も出なければ完了）
dig +short stockly.gucchii.com A

# （VPS）PM2・DB・置き場・鍵が残っていないこと
pm2 describe stockly >/dev/null 2>&1 && echo "PM2にまだ残っている" || echo "ok"
mysql -u root -p -e "SHOW DATABASES LIKE 'app_stockly';" | grep -q app_ && echo "DBがまだ残っている" || echo "ok"
test -e /home/github-user/apps/stockly && echo "置き場がまだ残っている" || echo "ok"
grep -q 'app-deploy-gate stockly"' /home/github-user/.ssh/authorized_keys && echo "鍵がまだ残っている" || echo "ok"

# GitHub Secretsが残っていないこと（何も出なければ完了）
gh secret list --repo guchi-apps/stockly

# アーカイブ済みであること
gh repo view guchi-apps/stockly --json isArchived --jq .isArchived
```
