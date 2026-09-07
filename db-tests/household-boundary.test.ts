/**
 * 他家庭のデータを参照できないことを保証している複合外部キー（#3）が、実DB上で
 * 実際に効いていることを確認する（#18）。単一列の外部キーへ書き換えるような変更は
 * 純関数の単体テストでは検出できないため、実際のMySQL/MariaDBへINSERTして確かめる。
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";

import { Prisma } from "@prisma/client";

import {
  createHousehold,
  createProduct,
  createStorageLocation,
  createStoragePosition,
  deleteHousehold,
  prisma,
} from "./helpers.ts";

const createdHouseholdIds: string[] = [];

after(async () => {
  for (const id of createdHouseholdIds) {
    await deleteHousehold(id);
  }
  await prisma.$disconnect();
});

function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
}

test("他家庭の商品を参照するStockLotはINSERTできない", async () => {
  const owner = await createHousehold("db-test household（商品の所有側）");
  const intruder = await createHousehold("db-test household（越境しようとする側）");
  createdHouseholdIds.push(owner.id, intruder.id);

  const product = await createProduct(owner.id, "商品");

  await assert.rejects(
    () =>
      prisma.stockLot.create({
        data: { householdId: intruder.id, productId: product.id, unit: "PIECE" },
      }),
    isForeignKeyViolation,
  );
});

test("他家庭の保管場所を参照するStockLotはINSERTできない", async () => {
  const owner = await createHousehold("db-test household（保管場所の所有側）");
  const intruder = await createHousehold("db-test household（越境しようとする側）");
  createdHouseholdIds.push(owner.id, intruder.id);

  const product = await createProduct(intruder.id, "商品");
  const storageLocation = await createStorageLocation(owner.id, "保管場所");

  await assert.rejects(
    () =>
      prisma.stockLot.create({
        data: {
          householdId: intruder.id,
          productId: product.id,
          storageLocationId: storageLocation.id,
          unit: "PIECE",
        },
      }),
    isForeignKeyViolation,
  );
});

test("指定した保管場所の配下にないStoragePositionを参照するStockLotはINSERTできない", async () => {
  const household = await createHousehold("db-test household（保管位置の境界）");
  createdHouseholdIds.push(household.id);

  const product = await createProduct(household.id, "商品");
  const locationA = await createStorageLocation(household.id, "保管場所A");
  const locationB = await createStorageLocation(household.id, "保管場所B");
  // 同じ家庭内だが、locationBの配下にある詳細位置。
  const positionUnderB = await createStoragePosition(household.id, locationB.id, "位置B-1");

  await assert.rejects(
    () =>
      prisma.stockLot.create({
        data: {
          householdId: household.id,
          productId: product.id,
          // locationAを指定しつつ、locationBの配下の詳細位置を参照させる。
          storageLocationId: locationA.id,
          storagePositionId: positionUnderB.id,
          unit: "PIECE",
        },
      }),
    isForeignKeyViolation,
  );
});
