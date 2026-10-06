/**
 * 認証idが変わって分かれた利用者を確かめ、本人と確認できた1人だけを付け替える運用スクリプト（#134）。
 *
 *   pnpm auth:account-links
 *       読み取りだけ。同じメールのUserが2人以上いる組と、それぞれの所属・在庫の件数を一覧する
 *   pnpm auth:account-links -- relink --user <userId> --supabase-user-id <新しいid>
 *       dry-run: 付け替えられるかだけを確かめる（何も書かない）
 *   pnpm auth:account-links -- relink --user <userId> --supabase-user-id <新しいid> --apply
 *       そのUserのsupabaseUserIdを付け替える（家庭・在庫・履歴・所属はそのまま引き継がれる）
 *
 * 手順と判断の基準は docs/account-recovery.md。**メールが同じというだけで付け替えない。**
 * 家庭の削除・在庫の付け替え・Userの削除はこのスクリプトでは行わない。
 *
 * `node --test`と同じstrip-onlyモードで動くため、型注釈以外のTS構文は使えない（CLAUDE.md）。
 */
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

import { findAccountSplits, relinkUserManually } from "../src/lib/auth/account-recovery.ts";

// 素のnodeは.env.localを読まないため明示的に読む。本番（VPS）では.envを読む。
loadEnv({ path: [".env.local", ".env"], quiet: true });

// `pnpm auth:account-links -- relink ...`では区切りの`--`もそのまま渡ってくるので外す。
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const prisma = new PrismaClient();

function option(name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

try {
  if (args[0] === "relink") {
    const userId = option("--user");
    const supabaseUserId = option("--supabase-user-id");
    if (!userId || !supabaseUserId) {
      console.error("--user と --supabase-user-id を指定してください。");
      process.exitCode = 2;
    } else {
      const apply = args.includes("--apply");
      const result = await relinkUserManually(prisma, { userId, supabaseUserId, apply });
      switch (result.status) {
        case "dry_run":
          console.log(
            `付け替えられます（dry-run）: User ${result.userId} の supabaseUserId を ` +
              `${result.previousSupabaseUserId} → ${supabaseUserId}。書き込むには --apply を付けます。`,
          );
          break;
        case "relinked":
          console.log(
            `付け替えました: User ${result.userId} の supabaseUserId を ` +
              `${result.previousSupabaseUserId} → ${supabaseUserId}。`,
          );
          break;
        case "user_not_found":
          console.error(`User ${userId} がありません。`);
          process.exitCode = 1;
          break;
        case "already_linked":
          console.log("すでにその supabaseUserId に結びついています。何もしませんでした。");
          break;
        case "supabase_user_in_use":
          console.error(
            `その supabaseUserId はすでに User ${result.holderUserId} ` +
              `（所属 ${result.holderMembershipCount}件）が使っています。何もしませんでした。` +
              "扱いは docs/account-recovery.md を見て個別に決めてください。",
          );
          process.exitCode = 1;
          break;
      }
    }
  } else {
    const splits = await findAccountSplits(prisma);
    if (splits.length === 0) {
      console.log("同じメールを持つUserの組はありません。");
    }
    for (const split of splits) {
      console.log(`\n${split.maskedEmail}（${split.users.length}人）`);
      for (const user of split.users) {
        console.log(
          `  User ${user.userId}  supabaseUserId=${user.supabaseUserId}  ` +
            `googleSubject=${user.hasGoogleSubject ? "あり" : "なし"}  ` +
            `作成 ${user.createdAt.toISOString()}`,
        );
        if (user.memberships.length === 0) console.log("    所属なし");
        for (const m of user.memberships) {
          console.log(
            `    ${m.removed ? "[外れた] " : ""}${m.householdName}（${m.householdId}） ${m.role}  ` +
              `ロット${m.stockLotCount}件・履歴${m.transactionCount}件`,
          );
        }
      }
    }
  }
} finally {
  await prisma.$disconnect();
}
