/**
 * 防災バッグの点検（`DisasterBag`・`DisasterBagInspection`、#8）が
 * DB側でも家庭の境界に従い、既定値がスキーマとコードで一致していることを確認する。
 *
 * `src/lib/disaster/bag.ts`の`DEFAULT_DISASTER_BAG_PLAN`とスキーマの`@default`は
 * 別々に書いてあるため、**片方だけ変えても純関数のテストでは気付けない**
 * （`disaster-plan.test.ts`が`DisasterPlanSetting`について見ているのと同じ約束）。
 *
 * 境界のほうは、バッグが**保管場所を複合外部キー`[householdId, storageLocationId]`で
 * 参照している**ことを確かめる。単一列の外部キーにすると、他家庭の保管場所を指す
 * バッグが作れてしまい、その中身として他家庭の在庫が点検画面へ出る。
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";

import { DEFAULT_DISASTER_BAG_PLAN } from "../src/lib/disaster/bag.ts";

import {
  assertRejectedByDatabase,
  createHousehold,
  createStorageLocation,
  deleteHousehold,
  isUniqueViolation,
  prisma,
} from "./helpers.ts";

const createdHouseholdIds: string[] = [];

after(async () => {
  for (const id of createdHouseholdIds) {
    await prisma.disasterBagInspection.deleteMany({ where: { householdId: id } });
    await prisma.disasterBag.deleteMany({ where: { householdId: id } });
    await deleteHousehold(id);
  }
  await prisma.$disconnect();
});

async function householdWithBagLocation(name: string) {
  const household = await createHousehold(name);
  createdHouseholdIds.push(household.id);
  const location = await createStorageLocation(household.id, "防災バッグ");
  return { household, location };
}

test("DB側の既定値が DEFAULT_DISASTER_BAG_PLAN と一致する", async () => {
  const { household, location } = await householdWithBagLocation(
    "db-test household（防災バッグの既定値）",
  );

  const saved = await prisma.disasterBag.create({
    data: { householdId: household.id, storageLocationId: location.id },
  });

  assert.equal(saved.peopleCount, DEFAULT_DISASTER_BAG_PLAN.peopleCount);
  assert.equal(saved.targetDays, DEFAULT_DISASTER_BAG_PLAN.targetDays);
  assert.equal(
    saved.inspectionIntervalDays,
    DEFAULT_DISASTER_BAG_PLAN.inspectionIntervalDays,
  );
});

test("1つの保管場所に2件目の防災バッグは作れない", async () => {
  const { household, location } = await householdWithBagLocation(
    "db-test household（防災バッグの重複）",
  );

  await prisma.disasterBag.create({
    data: { householdId: household.id, storageLocationId: location.id },
  });

  await assert.rejects(
    () =>
      prisma.disasterBag.create({
        data: { householdId: household.id, storageLocationId: location.id },
      }),
    isUniqueViolation,
  );
});

test("他家庭の保管場所を指す防災バッグは作れない", async () => {
  const mine = await createHousehold("db-test household（防災バッグ・自分）");
  const theirs = await createHousehold("db-test household（防災バッグ・他人）");
  createdHouseholdIds.push(mine.id, theirs.id);

  const theirLocation = await createStorageLocation(theirs.id, "他人の防災バッグ");

  await assertRejectedByDatabase(
    () =>
      prisma.disasterBag.create({
        // householdIdは自分、保管場所は他家庭のもの。単一列の外部キーなら通ってしまう。
        data: { householdId: mine.id, storageLocationId: theirLocation.id },
      }),
    () => prisma.disasterBag.count({ where: { householdId: mine.id } }),
  );
});

test("他家庭の防災バッグを指す点検記録は作れない", async () => {
  const mine = await createHousehold("db-test household（点検記録・自分）");
  const theirs = await createHousehold("db-test household（点検記録・他人）");
  createdHouseholdIds.push(mine.id, theirs.id);

  const theirLocation = await createStorageLocation(theirs.id, "他人の防災バッグ");
  const theirBag = await prisma.disasterBag.create({
    data: { householdId: theirs.id, storageLocationId: theirLocation.id },
  });

  await assertRejectedByDatabase(
    () =>
      prisma.disasterBagInspection.create({
        data: {
          householdId: mine.id,
          disasterBagId: theirBag.id,
          inspectedOn: new Date("2026-09-08T00:00:00.000Z"),
          ruleVersion: "v1",
        },
      }),
    () => prisma.disasterBagInspection.count({ where: { householdId: mine.id } }),
  );
});

test("点検記録は件数とルール版を保存し、家庭を消すと一緒に消える", async () => {
  const { household, location } = await householdWithBagLocation(
    "db-test household（点検記録の保存）",
  );

  const bag = await prisma.disasterBag.create({
    data: { householdId: household.id, storageLocationId: location.id },
  });
  const saved = await prisma.disasterBagInspection.create({
    data: {
      householdId: household.id,
      disasterBagId: bag.id,
      inspectedOn: new Date("2026-09-08T00:00:00.000Z"),
      note: "携帯トイレを3回ぶんに補充した",
      itemCount: 7,
      expiredCount: 0,
      expiringSoonCount: 0,
      unknownExpiryCount: 1,
      ruleVersion: "v1",
    },
  });

  // 期限の列と同じDATE型なので、Prismaは時刻を持たないUTC0時のDateとして返す。
  assert.equal(saved.inspectedOn.toISOString(), "2026-09-08T00:00:00.000Z");
  assert.equal(saved.itemCount, 7);
  assert.equal(saved.unknownExpiryCount, 1);
  assert.equal(saved.ruleVersion, "v1");

  await prisma.disasterBagInspection.deleteMany({ where: { householdId: household.id } });
  await prisma.disasterBag.deleteMany({ where: { householdId: household.id } });
  await deleteHousehold(household.id);
  createdHouseholdIds.splice(createdHouseholdIds.indexOf(household.id), 1);

  assert.equal(
    await prisma.disasterBagInspection.count({ where: { householdId: household.id } }),
    0,
  );
});
