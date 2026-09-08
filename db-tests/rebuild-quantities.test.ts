/**
 * 障害・復元のあとに、入出庫履歴（正本）から`StockLot.quantity`（集計値）を組み立て直せることを
 * 実DBで確認する（#13）。手順そのものは docs/backup-restore.md の「履歴から現在庫を再構築する」。
 *
 * 集計値をわざと壊してから`rebuildLotQuantities()`を流し、dry-runでは検出だけ・`--apply`相当では
 * 履歴の合計へ戻ることを見る。他家庭のロットには触れないことも併せて確かめる。
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";

import { Prisma } from "@prisma/client";

import { rebuildLotQuantities } from "../src/lib/inventory/rebuild.ts";
import { createHousehold, createProduct, deleteHousehold, prisma } from "./helpers.ts";

const createdHouseholdIds: string[] = [];

after(async () => {
  for (const id of createdHouseholdIds) {
    await deleteHousehold(id);
  }
  await prisma.$disconnect();
});

/** 購入5・消費2・取消(+2)の履歴を持つロットを作る。履歴の合計は5。 */
async function createLotWithHistory(householdId: string, productName: string) {
  const product = await createProduct(householdId, productName);
  const lot = await prisma.stockLot.create({
    data: { householdId, productId: product.id, unit: "PIECE", quantity: "5" },
  });

  const base = { householdId, stockLotId: lot.id, productId: product.id, unit: "PIECE" as const };
  const purchase = await prisma.inventoryTransaction.create({
    data: { ...base, type: "PURCHASE", quantityDelta: "5", occurredAt: new Date("2026-09-01T00:00:00Z") },
  });
  const consume = await prisma.inventoryTransaction.create({
    data: { ...base, type: "CONSUME", quantityDelta: "-2", occurredAt: new Date("2026-09-02T00:00:00Z") },
  });
  await prisma.inventoryTransaction.create({
    data: {
      ...base,
      type: "REVERSAL",
      quantityDelta: "2",
      reversesTransactionId: consume.id,
      occurredAt: new Date("2026-09-03T00:00:00Z"),
    },
  });

  return { lot, purchase };
}

test("集計値が履歴とずれたロットを検出し、--applyで履歴の合計へ戻す", async () => {
  const household = await createHousehold("db-test household（再構築）");
  createdHouseholdIds.push(household.id);

  const { lot } = await createLotWithHistory(household.id, "再構築する商品");
  const intact = await createLotWithHistory(household.id, "ずれていない商品");

  // 障害で集計値だけが壊れた状態を作る（履歴は正しいまま）。
  await prisma.stockLot.update({
    where: { id: lot.id },
    data: { quantity: "99", status: "ACTIVE" },
  });

  // dry-run: 検出するだけで、DBは変えない。
  const dryRun = await rebuildLotQuantities(prisma, { householdId: household.id });
  assert.equal(dryRun.applied, false);
  assert.equal(dryRun.checked, 2);
  assert.equal(dryRun.consistent, 1);
  assert.deepEqual(
    dryRun.drifted.map((drift) => drift.lotId),
    [lot.id],
    "壊したロットだけがずれとして挙がる",
  );
  assert.equal(dryRun.drifted[0].result.stored.amount.toString(), "99");
  assert.equal(dryRun.drifted[0].result.computed.amount.toString(), "5");
  assert.equal(dryRun.errors.length, 0);

  const untouched = await prisma.stockLot.findUniqueOrThrow({ where: { id: lot.id } });
  assert.equal(untouched.quantity.toString(), "99", "dry-runではUPDATEしない");

  // apply: 集計値を履歴の合計へ戻す。履歴の件数は変わらない。
  const transactionsBefore = await prisma.inventoryTransaction.count({
    where: { householdId: household.id },
  });
  const applied = await rebuildLotQuantities(prisma, { householdId: household.id, apply: true });
  assert.equal(applied.applied, true);
  assert.equal(applied.drifted.length, 1);

  const rebuilt = await prisma.stockLot.findUniqueOrThrow({ where: { id: lot.id } });
  assert.equal(rebuilt.quantity.toString(), "5");
  assert.equal(rebuilt.status, "ACTIVE");

  const intactLot = await prisma.stockLot.findUniqueOrThrow({ where: { id: intact.lot.id } });
  assert.equal(intactLot.quantity.toString(), "5", "ずれていないロットは触らない");

  const transactionsAfter = await prisma.inventoryTransaction.count({
    where: { householdId: household.id },
  });
  assert.equal(transactionsAfter, transactionsBefore, "履歴（正本）は書き換えない");

  // 直したあとは一致する。
  const verified = await rebuildLotQuantities(prisma, { householdId: household.id });
  assert.equal(verified.drifted.length, 0);
  assert.equal(verified.consistent, 2);
});

test("履歴の合計が0になったロットはDEPLETEDへ、負になったロットはACTIVEのまま戻す", async () => {
  const household = await createHousehold("db-test household（再構築・状態）");
  createdHouseholdIds.push(household.id);

  const product = await createProduct(household.id, "使い切る商品");
  const depleted = await prisma.stockLot.create({
    data: { householdId: household.id, productId: product.id, unit: "PIECE", quantity: "3" },
  });
  const base = { householdId: household.id, productId: product.id, unit: "PIECE" as const };
  await prisma.inventoryTransaction.createMany({
    data: [
      { ...base, stockLotId: depleted.id, type: "PURCHASE", quantityDelta: "3", occurredAt: new Date() },
      { ...base, stockLotId: depleted.id, type: "CONSUME", quantityDelta: "-3", occurredAt: new Date() },
    ],
  });

  const negativeProduct = await createProduct(household.id, "取消で負になった商品");
  const negative = await prisma.stockLot.create({
    data: { householdId: household.id, productId: negativeProduct.id, unit: "PIECE", quantity: "1" },
  });
  const purchase = await prisma.inventoryTransaction.create({
    data: {
      ...base,
      productId: negativeProduct.id,
      stockLotId: negative.id,
      type: "PURCHASE",
      quantityDelta: "2",
      occurredAt: new Date(),
    },
  });
  await prisma.inventoryTransaction.createMany({
    data: [
      { ...base, productId: negativeProduct.id, stockLotId: negative.id, type: "CONSUME", quantityDelta: "-2", occurredAt: new Date() },
      {
        ...base,
        productId: negativeProduct.id,
        stockLotId: negative.id,
        type: "REVERSAL",
        quantityDelta: "-2",
        reversesTransactionId: purchase.id,
        occurredAt: new Date(),
      },
    ],
  });

  const report = await rebuildLotQuantities(prisma, { householdId: household.id, apply: true });
  assert.equal(report.drifted.length, 2);

  const depletedAfter = await prisma.stockLot.findUniqueOrThrow({ where: { id: depleted.id } });
  assert.equal(depletedAfter.quantity.toString(), "0");
  assert.equal(depletedAfter.status, "DEPLETED");

  const negativeAfter = await prisma.stockLot.findUniqueOrThrow({ where: { id: negative.id } });
  assert.equal(negativeAfter.quantity.toString(), "-2");
  assert.equal(negativeAfter.status, "ACTIVE", "負のロットは一覧から消さない（CLAUDE.md）");
});

test("家庭を指定した再構築は、他家庭のずれに触れない", async () => {
  const target = await createHousehold("db-test household（再構築・対象）");
  const other = await createHousehold("db-test household（再構築・対象外）");
  createdHouseholdIds.push(target.id, other.id);

  const targetLot = await createLotWithHistory(target.id, "対象の商品");
  const otherLot = await createLotWithHistory(other.id, "対象外の商品");
  await prisma.stockLot.updateMany({
    where: { id: { in: [targetLot.lot.id, otherLot.lot.id] } },
    data: { quantity: new Prisma.Decimal("42") },
  });

  const report = await rebuildLotQuantities(prisma, { householdId: target.id, apply: true });
  assert.deepEqual(
    report.drifted.map((drift) => drift.lotId),
    [targetLot.lot.id],
  );

  const otherAfter = await prisma.stockLot.findUniqueOrThrow({ where: { id: otherLot.lot.id } });
  assert.equal(otherAfter.quantity.toString(), "42", "指定していない家庭のロットは変えない");
});
