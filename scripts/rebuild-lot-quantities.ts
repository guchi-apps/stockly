/**
 * 入出庫履歴（正本）から`StockLot.quantity`（集計値）を組み立て直す運用スクリプト（#13）。
 *
 *   pnpm db:rebuild-quantities                 # dry-run: ずれているロットを一覧するだけ
 *   pnpm db:rebuild-quantities -- --apply      # ずれたロットの数量・状態を履歴の合計へ戻す
 *   pnpm db:rebuild-quantities -- --household <householdId>   # 1家庭に絞る
 *
 * 使う場面は docs/backup-restore.md の「履歴から現在庫を再構築する」を参照。
 * 履歴（InventoryTransaction）は一切書き換えない。終了コードは、ずれ・照合不能が残っていれば1、
 * すべて一致していれば0（cron等から「直す必要があるか」を判定できるようにするため）。
 *
 * `node --test`と同じstrip-onlyモードで動くため、型注釈以外のTS構文は使えない（CLAUDE.md）。
 */
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

import { rebuildLotQuantities } from "../src/lib/inventory/rebuild.ts";
import { formatQuantity } from "../src/lib/inventory/units.ts";

// prisma CLI・next devと違い、素のnodeは.env.localを読まないため明示的に読む。
// 本番（VPS）では.envに値があり、環境変数として渡されるので無くてもよい。
loadEnv({ path: ".env.local", quiet: true });

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const householdIndex = args.indexOf("--household");
const householdId = householdIndex >= 0 ? args[householdIndex + 1] : undefined;

if (householdIndex >= 0 && !householdId) {
  console.error("--household には householdId を続けて指定してください。");
  process.exit(2);
}

const prisma = new PrismaClient();

try {
  const report = await rebuildLotQuantities(prisma, { apply, householdId });

  console.log(
    `${apply ? "再構築" : "照合（dry-run）"}: ${report.checked}ロットを確認、` +
      `${report.consistent}件一致、${report.drifted.length}件ずれ、${report.errors.length}件照合不能` +
      (householdId ? `（家庭 ${householdId}）` : ""),
  );

  for (const drift of report.drifted) {
    const { stored, computed, difference } = drift.result;
    console.log(
      `  ${apply ? "修正" : "ずれ"} lot=${drift.lotId} household=${drift.householdId} ${drift.productName}: ` +
        `集計値 ${formatQuantity(stored)} → 履歴合計 ${formatQuantity(computed)}（差 ${formatQuantity(difference)}）`,
    );
  }

  for (const error of report.errors) {
    console.log(
      `  照合不能 lot=${error.lotId} household=${error.householdId} ${error.productName}: ${error.message}`,
    );
  }

  if (!apply && report.drifted.length > 0) {
    console.log("直すには `pnpm db:rebuild-quantities -- --apply` を実行してください。");
  }

  // 一致していれば0。applyした場合も、照合不能が残っていれば人が見る必要があるので1にする。
  const unresolved = (apply ? 0 : report.drifted.length) + report.errors.length;
  process.exitCode = unresolved > 0 ? 1 : 0;
} finally {
  await prisma.$disconnect();
}
