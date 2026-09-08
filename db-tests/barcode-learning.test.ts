/**
 * バーコードと学習ルール（#9）が、実DB上でも境界と一意性を守っていることを確認する。
 *
 * ここで見ているのは次の3つ。どれもアプリ側のコードでは「そう書いてあるだけ」で、
 * 単一列の外部キーやUNIQUEの外し忘れは純関数の単体テストでは検出できない。
 *
 * 1. 他家庭の商品・保管場所を`ProductRule`から参照できないこと（複合外部キー）
 * 2. 詳細位置は「指定した保管場所の配下」に限られること（3列の複合外部キー）
 * 3. 1つのコードが家庭内で1商品にしか紐付かないこと（`@@unique([householdId, code])`）
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";

import {
  createHousehold,
  createProduct,
  createStorageLocation,
  createStoragePosition,
  deleteHousehold,
  isForeignKeyViolation,
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

test("他家庭の商品を参照するProductRuleはINSERTできない", async () => {
  const owner = await createHousehold("db-test household（商品の所有側・ルール）");
  const intruder = await createHousehold("db-test household（越境しようとする側・ルール）");
  createdHouseholdIds.push(owner.id, intruder.id);

  const product = await createProduct(owner.id, "商品");

  await assert.rejects(
    () => prisma.productRule.create({ data: { householdId: intruder.id, productId: product.id } }),
    isForeignKeyViolation,
  );
});

test("他家庭の保管場所を参照するProductRuleはINSERTできない", async () => {
  const owner = await createHousehold("db-test household（保管場所の所有側・ルール）");
  const intruder = await createHousehold("db-test household（越境しようとする側・ルール）");
  createdHouseholdIds.push(owner.id, intruder.id);

  const product = await createProduct(intruder.id, "商品");
  const storageLocation = await createStorageLocation(owner.id, "保管場所");

  await assert.rejects(
    () =>
      prisma.productRule.create({
        data: {
          householdId: intruder.id,
          productId: product.id,
          storageLocationId: storageLocation.id,
        },
      }),
    isForeignKeyViolation,
  );
});

test("指定した保管場所の配下にない詳細位置は、ProductRuleから参照できない", async () => {
  const household = await createHousehold("db-test household（詳細位置・ルール）");
  createdHouseholdIds.push(household.id);

  const product = await createProduct(household.id, "商品");
  const fridge = await createStorageLocation(household.id, "冷蔵庫");
  const pantry = await createStorageLocation(household.id, "食品棚");
  const pantryShelf = await createStoragePosition(household.id, pantry.id, "下棚");

  await assert.rejects(
    () =>
      prisma.productRule.create({
        data: {
          householdId: household.id,
          productId: product.id,
          // 保管場所は冷蔵庫なのに、詳細位置は食品棚のもの。
          storageLocationId: fridge.id,
          storagePositionId: pantryShelf.id,
        },
      }),
    isForeignKeyViolation,
  );
});

test("同じ商品に2つ目のProductRuleは作れない（覚えるのは常に最新の1件）", async () => {
  const household = await createHousehold("db-test household（ルールの一意性）");
  createdHouseholdIds.push(household.id);

  const product = await createProduct(household.id, "商品");
  await prisma.productRule.create({ data: { householdId: household.id, productId: product.id } });

  await assert.rejects(
    () => prisma.productRule.create({ data: { householdId: household.id, productId: product.id } }),
    isUniqueViolation,
  );
});

test("同じコードを2つの商品へ紐付けることはできない", async () => {
  const household = await createHousehold("db-test household（コードの一意性）");
  createdHouseholdIds.push(household.id);

  const cola = await createProduct(household.id, "コーラ");
  const soda = await createProduct(household.id, "サイダー");

  await prisma.barcode.create({
    data: { householdId: household.id, productId: cola.id, code: "4901777018884" },
  });

  await assert.rejects(
    () =>
      prisma.barcode.create({
        data: { householdId: household.id, productId: soda.id, code: "4901777018884" },
      }),
    isUniqueViolation,
  );
});

test("同じコードでも家庭が違えば別々に紐付けられる", async () => {
  const first = await createHousehold("db-test household（コード・家庭1）");
  const second = await createHousehold("db-test household（コード・家庭2）");
  createdHouseholdIds.push(first.id, second.id);

  const firstProduct = await createProduct(first.id, "コーラ");
  const secondProduct = await createProduct(second.id, "コーラ");

  await prisma.barcode.create({
    data: { householdId: first.id, productId: firstProduct.id, code: "4907773010419" },
  });
  const created = await prisma.barcode.create({
    data: { householdId: second.id, productId: secondProduct.id, code: "4907773010419" },
  });

  assert.equal(created.code, "4907773010419");
});

test("他家庭の商品を参照するBarcodeはINSERTできない", async () => {
  const owner = await createHousehold("db-test household（商品の所有側・コード）");
  const intruder = await createHousehold("db-test household（越境しようとする側・コード）");
  createdHouseholdIds.push(owner.id, intruder.id);

  const product = await createProduct(owner.id, "商品");

  await assert.rejects(
    () =>
      prisma.barcode.create({
        data: { householdId: intruder.id, productId: product.id, code: "45690228" },
      }),
    isForeignKeyViolation,
  );
});
