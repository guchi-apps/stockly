/**
 * `InventoryTransaction`の`@@unique([householdId, reversesTransactionId])`（#3）が
 * 実DB上で二重取消を防いでいることを確認する（#18）。
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";

import { Prisma } from "@prisma/client";

import { createHousehold, createProduct, deleteHousehold, prisma } from "./helpers.ts";

const createdHouseholdIds: string[] = [];

after(async () => {
  for (const id of createdHouseholdIds) {
    await deleteHousehold(id);
  }
  await prisma.$disconnect();
});

test("同じInventoryTransactionを二重に取り消せない", async () => {
  const household = await createHousehold("db-test household（二重取消）");
  createdHouseholdIds.push(household.id);

  const product = await createProduct(household.id, "商品");
  const lot = await prisma.stockLot.create({
    data: { householdId: household.id, productId: product.id, unit: "PIECE" },
  });

  const purchase = await prisma.inventoryTransaction.create({
    data: {
      householdId: household.id,
      stockLotId: lot.id,
      productId: product.id,
      type: "PURCHASE",
      quantityDelta: "5",
      unit: "PIECE",
      occurredAt: new Date(),
    },
  });

  const reversalInput = {
    householdId: household.id,
    stockLotId: lot.id,
    productId: product.id,
    type: "REVERSAL",
    quantityDelta: "-5",
    unit: "PIECE",
    occurredAt: new Date(),
    reversesTransactionId: purchase.id,
  } as const;

  // 1回目の取消は成功する。
  await prisma.inventoryTransaction.create({ data: reversalInput });

  // 同じtransactionへの2回目の取消は拒否される。
  await assert.rejects(
    () => prisma.inventoryTransaction.create({ data: reversalInput }),
    (error: unknown) =>
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002",
  );
});
