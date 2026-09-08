/**
 * `StockLot.quantity`（集計値）が`InventoryTransaction`の履歴（正本）と
 * ずれていないことを、seed投入後の全ロットで確認する（#18）。
 *
 * `pnpm db:migrate:deploy` → `pnpm db:seed` を先に実行しておくこと
 * （CIの`db-constraint-tests`ジョブは自動でこの順に実行する）。
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";

import { verifyLotQuantity, type LedgerEntry } from "../src/lib/inventory/ledger.ts";
import { prisma } from "./helpers.ts";

after(async () => {
  await prisma.$disconnect();
});

// scripts/seed-dev.mjs・prisma/seed.ts が使う「開発用の家」のid。
// 他のテスト（rebuild-quantities.test.ts）は自前の家庭で集計値をわざと壊すため、
// 全家庭を見ると並行実行時に巻き込まれる。seedの家庭だけを対象にする。
const SEED_HOUSEHOLD_ID = "dev-household-own";

test("seed投入後、全StockLotのquantityが入出庫履歴の合計と一致する", async () => {
  const lots = await prisma.stockLot.findMany({
    where: { householdId: SEED_HOUSEHOLD_ID },
    include: { transactions: true },
  });

  assert.ok(
    lots.length > 0,
    "StockLotが0件です。先に `pnpm db:seed` でサンプルデータを投入してください。",
  );

  for (const lot of lots) {
    const entries: LedgerEntry[] = lot.transactions.map((transaction) => ({
      id: transaction.id,
      type: transaction.type,
      quantityDelta: transaction.quantityDelta,
      unit: transaction.unit,
      reversesTransactionId: transaction.reversesTransactionId,
    }));

    const result = verifyLotQuantity(lot, entries);
    assert.ok(
      result.consistent,
      `lot ${lot.id} の quantity(${result.stored.amount.toString()}) が` +
        `履歴の合計(${result.computed.amount.toString()})と一致しません。`,
    );
  }
});
