# 認証idが変わったときのアカウント復旧

Stocklyの利用者（`User`）は、在庫・履歴・家庭の所属の持ち主を表す。共有のSupabaseプロジェクトで
ユーザーが作り直されると、同じGoogleアカウントでも`supabaseUserId`が変わってログインしてくる（#134）。
このとき**新しいUserと家庭を作らない**、**メールが同じというだけで既存のUserへ寄せない**、の2つを守る。

## ログイン時に自動で行うこと

`src/lib/auth/account-link.ts`の`linkStocklyUser()`が、OAuthコールバックで次の順に照合する。

| 照合 | 結果 |
| --- | --- |
| `supabaseUserId`が一致するUserがある | いつもどおりログイン。`googleSubject`が空なら記録する |
| `googleSubject`（Googleの`sub`）が一致するUserがある | **そのUserの`supabaseUserId`を付け替える**。User.id・所属・役割・履歴の記録者はそのまま |
| どちらも無く、同じメールのUserも無い | 新規利用者。Userと初期の家庭（OWNER）を作る |
| どちらも無いが、同じメールのUserがある | **何も作らない。** `/login?error=account_recovery`へ戻し、ログに`reason=same_email supabaseUserId=<新しいid>`を残す |
| `supabaseUserId`は一致するが、記録済みの`googleSubject`と違う | 上書きせず同じく復旧へ回す（`reason=subject_mismatch`） |

- Googleの`sub`は**Supabaseの`identities`（`auth.identities`）からだけ**取る。`user_metadata`は
  本人が`updateUser()`で書き換えられるため、照合の根拠にしない
- Supabaseは1つのGoogleアカウントを同時に2人のユーザーへ結びつけない（`(provider, provider_id)`が一意）。
  `sub`が一致する旧いUserの`supabaseUserId`は、もうそのアカウントのものではないので、付け替えてよい
- 照合・付け替え・初期の家庭の作成は1つのトランザクションで、同時ログインの一意制約違反は
  トランザクションごと3回までやり直す。途中で失敗しても部分的な付け替えは残らない
- 除名・脱退した所属（`removedAt`あり）は、付け替えても復活しない。いま所属している家庭が
  1つも無ければ、従来どおり新しい家庭を作る

**`googleSubject`の列（#134）を入れる前から居る利用者は、次にログインするまで空のまま。**
空のあいだに認証idが変わると自動では照合できず、下の「人が行う復旧」になる。

## 人が行う復旧

ログイン画面に「以前のStocklyのデータとこのアカウントを自動で結びつけられませんでした」が出た、
またはログに`既存の利用者と照合できないため復旧が必要`が出たときの手順。

1. **状況を読み取りで確かめる**（何も書き換えない）

   ```bash
   pnpm auth:account-links
   ```

   同じメールを持つUserの組と、それぞれの所属・役割・ロット件数・履歴件数を出す（メールは伏せ字）。
   #134の修正より前に分かれてしまった組（新しいUserと空の家庭ができている）もここで見つかる。

2. **本人であることを、メール以外の手段で確かめる。** 同じメールでも別の本人でありうる。
   利用者本人に連絡を取り、Supabaseのダッシュボードで新しいユーザーのid（ログの`supabaseUserId=`）と
   Googleアカウントが本人のものであることを確認する。確認できなければ付け替えない

3. **付け替える**（まずdry-run）

   ```bash
   pnpm auth:account-links -- relink --user <旧いUserのid> --supabase-user-id <新しいid>
   pnpm auth:account-links -- relink --user <旧いUserのid> --supabase-user-id <新しいid> --apply
   ```

   旧いUserの`supabaseUserId`だけを書き換え、`googleSubject`は空に戻す（次のログインで記録し直す）。
   家庭・在庫・履歴・所属は動かさない。

4. 本人に新しくログインしてもらい、以前の在庫・履歴・家庭のメンバーが見えることを確かめる。

本番で実行するときは、VPSの配置先で`cd <配置先> && pnpm auth:account-links`とする
（`.env`の`DATABASE_URL`を読む）。

### 付け替え先のidをすでに別のUserが持っている場合

#134の修正より前に分かれた場合は、新しいidで新しいUserと家庭ができている。`relink`は
`supabase_user_in_use`で断る（何も消さない）。

- **家庭の削除・在庫の一括付け替え・一意制約の追加で片付けない。** 新しい側の家庭にも、
  分かれてから記録した在庫や招待したメンバーが入っていることがある
- 新しい側の所属・在庫の件数（手順1の出力）を見て、どちらを残すか・新しい側に入れた在庫を
  どう移すかを利用者と決め、個別の復旧計画としてIssueに残してから作業する
- 新しい側のUserを手で消す場合も、そのUserが記録者として参照されている履歴があると
  DBが拒否する（`onDelete: Restrict`）。拒否されたら無理に消さず、計画を見直す

## 確認済みの事実と未確認のこと

- 2026-10-06時点で、Stocklyの本番でこの経路による分裂が起きたという報告・再現は無い。
  コードを読んで見つけた潜在的な欠陥（guchi-apps/docs#202の横断調査）として直した
- 本番に分かれたUserが既にあるかは、デプロイ後に`pnpm auth:account-links`で確かめる
