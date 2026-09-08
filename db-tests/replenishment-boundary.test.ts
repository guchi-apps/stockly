/**
 * 補充とNotion連携のモデル（#6）でも、他家庭のデータを参照できないことを実DBで確かめる。
 *
 * `ReplenishmentRule`・`ShoppingListEntry`は商品・カテゴリを`[householdId, 対象Id]`の
 * 複合外部キーで参照している。単一列の外部キーへ書き換えても型チェックも単体テストも通るため、
 * 「越境できない」という保証だけが静かに消える。ここで実際にINSERTして落ちることを見る。
 *
 * **拒否されたことをPrismaのエラーコードで判定しない**（#44）。同じ外部キー違反でも
 * DBによって1452（`P2003`）と1216（`PrismaClientUnknownRequestError`）に分かれるため、
 * `assertRejectedByDatabase()`で「DBまで往復したエラー」と「行が増えていないこと」を見る。
 * 一意制約（1062 → `P2002`）はどちらのDBでも同じに揃うので、そちらはコードで判定してよい。
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";

import { Prisma } from "@prisma/client";

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

function createCategory(householdId: string, name: string) {
  return prisma.category.create({ data: { householdId, name } });
}

test("他家庭の商品を対象にしたReplenishmentRuleはINSERTできない", async () => {
  const owner = await createHousehold("db-test household（商品の所有側・補充基準）");
  const intruder = await createHousehold("db-test household（越境しようとする側・補充基準）");
  createdHouseholdIds.push(owner.id, intruder.id);

  const product = await createProduct(owner.id, "商品");

  await assertRejectedByDatabase(
    () =>
      prisma.replenishmentRule.create({
        data: {
          householdId: intruder.id,
          productId: product.id,
          thresholdAmount: new Prisma.Decimal(1),
          targetAmount: new Prisma.Decimal(5),
          unit: "PIECE",
        },
      }),
    () => prisma.replenishmentRule.count({ where: { householdId: intruder.id } }),
  );
});

test("他家庭のカテゴリを対象にしたShoppingListEntryはINSERTできない", async () => {
  const owner = await createHousehold("db-test household（カテゴリの所有側・送信記録）");
  const intruder = await createHousehold("db-test household（越境しようとする側・送信記録）");
  createdHouseholdIds.push(owner.id, intruder.id);

  const category = await createCategory(owner.id, "飲料");

  await assertRejectedByDatabase(
    () =>
      prisma.shoppingListEntry.create({
        data: {
          householdId: intruder.id,
          categoryId: category.id,
          name: "飲料",
          shortageAmount: new Prisma.Decimal(26),
          unit: "LITER",
        },
      }),
    () => prisma.shoppingListEntry.count({ where: { householdId: intruder.id } }),
  );
});

test("同じ対象の補充基準は1件しか作れない", async () => {
  const household = await createHousehold("db-test household（基準は対象ごとに1件）");
  createdHouseholdIds.push(household.id);

  const product = await createProduct(household.id, "商品");
  const data = {
    householdId: household.id,
    productId: product.id,
    thresholdAmount: new Prisma.Decimal(1),
    targetAmount: new Prisma.Decimal(5),
    unit: "PIECE" as const,
  };

  await prisma.replenishmentRule.create({ data });
  await assert.rejects(() => prisma.replenishmentRule.create({ data }), isUniqueViolation);
});

test("対象がカテゴリの行が複数あっても、productIdのNULLどうしは衝突しない", async () => {
  // MySQLのUNIQUEはNULLを重複扱いしない。この前提が崩れると、カテゴリの基準を
  // 2件目から作れなくなる（商品の基準も同様）。
  const household = await createHousehold("db-test household（NULLは重複扱いしない）");
  createdHouseholdIds.push(household.id);

  const drink = await createCategory(household.id, "飲料");
  const daily = await createCategory(household.id, "日用品");

  for (const category of [drink, daily]) {
    await prisma.replenishmentRule.create({
      data: {
        householdId: household.id,
        categoryId: category.id,
        thresholdAmount: new Prisma.Decimal(1),
        targetAmount: new Prisma.Decimal(5),
        unit: "PIECE",
      },
    });
  }

  const rules = await prisma.replenishmentRule.count({ where: { householdId: household.id } });
  assert.equal(rules, 2);
});

test("送信記録は対象ごとに1件（同じ候補を送り直してもNotionの項目が増えない土台）", async () => {
  const household = await createHousehold("db-test household（送信記録は対象ごとに1件）");
  createdHouseholdIds.push(household.id);

  const product = await createProduct(household.id, "商品");
  const data = {
    householdId: household.id,
    productId: product.id,
    name: "商品",
    shortageAmount: new Prisma.Decimal(3),
    unit: "PIECE" as const,
  };

  await prisma.shoppingListEntry.create({ data });
  await assert.rejects(() => prisma.shoppingListEntry.create({ data }), isUniqueViolation);
});
