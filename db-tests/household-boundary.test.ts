/**
 * 他家庭のデータを参照できないことを保証している複合外部キー（#3）が、実DB上で
 * 実際に効いていることを確認する（#18）。単一列の外部キーへ書き換えるような変更は
 * 純関数の単体テストでは検出できないため、実際のMySQL/MariaDBへINSERTして確かめる。
 */
import { after, test } from "node:test";

import {
  assertRejectedByDatabase,
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

test("他家庭の商品を参照するStockLotはINSERTできない", async () => {
  const owner = await createHousehold("db-test household（商品の所有側）");
  const intruder = await createHousehold("db-test household（越境しようとする側）");
  createdHouseholdIds.push(owner.id, intruder.id);

  const product = await createProduct(owner.id, "商品");

  await assertRejectedByDatabase(
    () =>
      prisma.stockLot.create({
        data: { householdId: intruder.id, productId: product.id, unit: "PIECE" },
      }),
    () => prisma.stockLot.count({ where: { householdId: intruder.id } }),
  );
});

test("他家庭の保管場所を参照するStockLotはINSERTできない", async () => {
  const owner = await createHousehold("db-test household（保管場所の所有側）");
  const intruder = await createHousehold("db-test household（越境しようとする側）");
  createdHouseholdIds.push(owner.id, intruder.id);

  const product = await createProduct(intruder.id, "商品");
  const storageLocation = await createStorageLocation(owner.id, "保管場所");

  await assertRejectedByDatabase(
    () =>
      prisma.stockLot.create({
        data: {
          householdId: intruder.id,
          productId: product.id,
          storageLocationId: storageLocation.id,
          unit: "PIECE",
        },
      }),
    () => prisma.stockLot.count({ where: { householdId: intruder.id } }),
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

  await assertRejectedByDatabase(
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
    () => prisma.stockLot.count({ where: { householdId: household.id } }),
  );
});

// --- 入出庫履歴（InventoryTransaction）の越境（#13） ---
//
// 在庫を変える処理は`service.ts`が`scopeToHousehold()`で得た`householdId`しか使わないが、
// そこを迂回した書き込み（直接SQL・別経路のバグ）が他家庭のロットや記録者を指せないことを、
// 複合外部キーでDB側にも担保させている。IDOR（他家庭のidを渡す）の最後の砦にあたる。

test("他家庭のロットを参照するInventoryTransactionはINSERTできない", async () => {
  const owner = await createHousehold("db-test household（ロットの所有側）");
  const intruder = await createHousehold("db-test household（他家庭のロットへ記録しようとする側）");
  createdHouseholdIds.push(owner.id, intruder.id);

  const ownerProduct = await createProduct(owner.id, "商品");
  const ownerLot = await prisma.stockLot.create({
    data: { householdId: owner.id, productId: ownerProduct.id, unit: "PIECE" },
  });
  const intruderProduct = await createProduct(intruder.id, "商品");

  await assertRejectedByDatabase(
    () =>
      prisma.inventoryTransaction.create({
        data: {
          householdId: intruder.id,
          stockLotId: ownerLot.id,
          productId: intruderProduct.id,
          type: "CONSUME",
          quantityDelta: "-1",
          unit: "PIECE",
          occurredAt: new Date(),
        },
      }),
    () => prisma.inventoryTransaction.count({ where: { householdId: intruder.id } }),
  );
});

test("他家庭のメンバーを記録者にしたInventoryTransactionはINSERTできない", async () => {
  const owner = await createHousehold("db-test household（記録先）");
  const other = await createHousehold("db-test household（メンバーの所属先）");
  createdHouseholdIds.push(owner.id, other.id);

  const user = await prisma.user.create({
    data: { supabaseUserId: `db-test-${owner.id}`, name: "db-test user" },
  });
  const otherMember = await prisma.householdMember.create({
    data: { householdId: other.id, userId: user.id },
  });

  const product = await createProduct(owner.id, "商品");
  const lot = await prisma.stockLot.create({
    data: { householdId: owner.id, productId: product.id, unit: "PIECE" },
  });

  try {
    await assertRejectedByDatabase(
      () =>
        prisma.inventoryTransaction.create({
          data: {
            householdId: owner.id,
            stockLotId: lot.id,
            productId: product.id,
            memberId: otherMember.id,
            type: "PURCHASE",
            quantityDelta: "1",
            unit: "PIECE",
            occurredAt: new Date(),
          },
        }),
      () => prisma.inventoryTransaction.count({ where: { householdId: owner.id } }),
    );
  } finally {
    // Userは家庭のCascadeでは消えないので、ここで消す（所属は家庭ごと消える）。
    await prisma.householdMember.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});
