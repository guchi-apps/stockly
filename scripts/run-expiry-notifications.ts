/**
 * 期限の通知をまとめて作る（`pnpm job:expiry`）。サーバーのcronから1日1回動かす想定。
 *
 * 画面の「いま期限を確認する」と同じ`runExpiryNotifications()`を呼ぶ。判定を二重に書かないため。
 *
 * `node`から直接動かせるよう、読み込むのは相対パスのモジュールだけにしてある
 * （Next.jsのパスエイリアス`@/`はここでは解決できない）。`.env.local`は自動では読まれないので
 * dotenvで明示的に読む。すでに環境変数がある場合は上書きしない（本番はPM2が`.env`を渡す）。
 *
 * `main().then()`の形にしてあるのは、`package.json`に`"type": "module"`が無く、
 * このファイルがCommonJSとして読まれるため（トップレベルawaitが使えない）。seed.tsと同じ形。
 */
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

import { runExpiryNotifications } from "../src/lib/notifications/expiry-job.ts";

loadEnv({ path: ".env.local", quiet: true });

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const summary = await runExpiryNotifications(prisma);
  const skipped = summary.details.filter((detail) => detail.skipped !== null).length;

  console.log(
    `[stockly][job:expiry] households=${summary.households} sent=${summary.sent} duplicate=${summary.duplicate} failed=${summary.failed} skipped=${skipped}`,
  );

  // 送信に失敗したものがあれば、cronのログとして失敗を残す（通知が届いていないため）。
  if (summary.failed > 0) process.exitCode = 1;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error("[stockly][job:expiry] 実行に失敗しました", error);
    await prisma.$disconnect();
    process.exit(1);
  });
