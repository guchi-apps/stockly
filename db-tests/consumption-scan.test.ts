/**
 * 写真からの減算候補（#11）のDB制約を、実DBに対して確かめる。
 *
 * ここで見るのは2つ。
 *
 * 1. **画像再送で解析が二重に作られないこと**（`@@unique([householdId, imageFingerprint])`）。
 *    受入条件の「画像再送」の土台で、コード側の「前回の候補を返す」分岐はこの制約に支えられている
 * 2. **候補が他家庭のロット・商品・履歴を指せないこと**（複合外部キー）。
 *    単一列の外部キーへ書き換えるような変更は、純関数のテストでは検出できない
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";

import {
  assertRejectedByDatabase,
  createHousehold,
  createProduct,
  deleteHousehold,
  isUniqueViolation,
  prisma,
} from "./helpers.ts";

const createdHouseholdIds: string[] = [];

after(async () => {
  for (const id of createdHouseholdIds) {
    await deleteHousehold(id);
  }
  await prisma.$disconnect();
});

function createScan(householdId: string, fingerprint: string) {
  return prisma.consumptionScan.create({
    data: {
      householdId,
      kind: "SHELF",
      imageFingerprint: fingerprint,
      imageCount: 1,
      ruleVersion: "v1",
    },
  });
}

test("同じ家庭で同じ画像の解析は2件作れない（画像再送）", async () => {
  const household = await createHousehold("db-test household（画像再送）");
  createdHouseholdIds.push(household.id);

  const fingerprint = "a".repeat(64);
  await createScan(household.id, fingerprint);

  let error: unknown;
  try {
    await createScan(household.id, fingerprint);
  } catch (caught) {
    error = caught;
  }

  assert.ok(isUniqueViolation(error), `一意制約で弾かれなかった: ${String(error)}`);
  assert.equal(await prisma.consumptionScan.count({ where: { householdId: household.id } }), 1);
});

test("別の家庭なら同じ画像でも解析を作れる", async () => {
  const first = await createHousehold("db-test household（画像の指紋・1）");
  const second = await createHousehold("db-test household（画像の指紋・2）");
  createdHouseholdIds.push(first.id, second.id);

  const fingerprint = "b".repeat(64);
  await createScan(first.id, fingerprint);
  await createScan(second.id, fingerprint);

  assert.equal(await prisma.consumptionScan.count({ where: { imageFingerprint: fingerprint } }), 2);
});

test("他家庭の解析にぶら下がる候補はINSERTできない", async () => {
  const owner = await createHousehold("db-test household（解析の所有側）");
  const intruder = await createHousehold("db-test household（越境しようとする側）");
  createdHouseholdIds.push(owner.id, intruder.id);

  const scan = await createScan(owner.id, "c".repeat(64));

  await assertRejectedByDatabase(
    () =>
      prisma.consumptionScanItem.create({
        data: { householdId: intruder.id, scanId: scan.id, detectedLabel: "越境" },
      }),
    () => prisma.consumptionScanItem.count({ where: { householdId: intruder.id } }),
  );
});

test("他家庭の在庫を対象にした候補はINSERTできない", async () => {
  const owner = await createHousehold("db-test household（在庫の所有側）");
  const intruder = await createHousehold("db-test household（越境しようとする側）");
  createdHouseholdIds.push(owner.id, intruder.id);

  const product = await createProduct(owner.id, "牛乳");
  const lot = await prisma.stockLot.create({
    data: { householdId: owner.id, productId: product.id, unit: "BOTTLE", quantity: 2 },
  });
  const scan = await createScan(intruder.id, "d".repeat(64));

  await assertRejectedByDatabase(
    () =>
      prisma.consumptionScanItem.create({
        data: {
          householdId: intruder.id,
          scanId: scan.id,
          detectedLabel: "牛乳",
          stockLotId: lot.id,
          unit: "BOTTLE",
          proposedAmount: 1,
        },
      }),
    () => prisma.consumptionScanItem.count({ where: { householdId: intruder.id } }),
  );
});

test("1件の履歴を2つの候補が確定したことにはできない", async () => {
  const household = await createHousehold("db-test household（確定した履歴）");
  createdHouseholdIds.push(household.id);

  const product = await createProduct(household.id, "牛乳");
  const lot = await prisma.stockLot.create({
    data: { householdId: household.id, productId: product.id, unit: "BOTTLE", quantity: 2 },
  });
  const transaction = await prisma.inventoryTransaction.create({
    data: {
      householdId: household.id,
      stockLotId: lot.id,
      productId: product.id,
      type: "CONSUME",
      quantityDelta: -1,
      unit: "BOTTLE",
      occurredAt: new Date(),
    },
  });
  const scan = await createScan(household.id, "e".repeat(64));

  await prisma.consumptionScanItem.create({
    data: {
      householdId: household.id,
      scanId: scan.id,
      detectedLabel: "牛乳",
      stockLotId: lot.id,
      unit: "BOTTLE",
      status: "CONFIRMED",
      transactionId: transaction.id,
      confirmedAmount: 1,
    },
  });

  let error: unknown;
  try {
    await prisma.consumptionScanItem.create({
      data: {
        householdId: household.id,
        scanId: scan.id,
        detectedLabel: "牛乳（2件目）",
        stockLotId: lot.id,
        unit: "BOTTLE",
        status: "CONFIRMED",
        transactionId: transaction.id,
        confirmedAmount: 1,
      },
    });
  } catch (caught) {
    error = caught;
  }

  assert.ok(isUniqueViolation(error), `一意制約で弾かれなかった: ${String(error)}`);
});
