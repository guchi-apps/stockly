/**
 * 防災の基準（`DisasterPlanSetting`、#7）がDB側でも家庭の境界に従い、
 * 既定値がスキーマとコードで一致していることを確認する。
 *
 * `src/lib/disaster/rules.ts`の`DEFAULT_DISASTER_PLAN`とスキーマの`@default`は別々に
 * 書いてあるため、**片方だけ変えても純関数のテストでは気付けない**。設定行が無い家庭
 * （コード側の既定値で動く）と、保存直後の家庭（DB側の既定値で動く）が同じ判定に
 * なることを、ここで固定する。
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";

import { DEFAULT_DISASTER_PLAN } from "../src/lib/disaster/rules.ts";

import { createHousehold, deleteHousehold, isUniqueViolation, prisma } from "./helpers.ts";

const createdHouseholdIds: string[] = [];

after(async () => {
  for (const id of createdHouseholdIds) {
    await deleteHousehold(id);
  }
  await prisma.$disconnect();
});

test("存在しない家庭の防災の基準はINSERTできない", async () => {
  await assert.rejects(() =>
    prisma.disasterPlanSetting.create({ data: { householdId: "no-such-household" } }),
  );
  assert.equal(
    await prisma.disasterPlanSetting.count({ where: { householdId: "no-such-household" } }),
    0,
  );
});

test("防災の基準は1家庭に1件しか持てない", async () => {
  const household = await createHousehold("db-test household（防災の基準）");
  createdHouseholdIds.push(household.id);

  await prisma.disasterPlanSetting.create({ data: { householdId: household.id } });

  await assert.rejects(
    () => prisma.disasterPlanSetting.create({ data: { householdId: household.id } }),
    isUniqueViolation,
  );
});

test("DB側の既定値が DEFAULT_DISASTER_PLAN と一致する", async () => {
  const household = await createHousehold("db-test household（防災の基準の既定値）");
  createdHouseholdIds.push(household.id);

  const saved = await prisma.disasterPlanSetting.create({
    data: { householdId: household.id },
  });

  assert.equal(saved.peopleCount, DEFAULT_DISASTER_PLAN.peopleCount);
  assert.equal(saved.targetDays, DEFAULT_DISASTER_PLAN.targetDays);
  assert.equal(
    saved.waterLitersPerPersonDay.toString(),
    DEFAULT_DISASTER_PLAN.waterLitersPerPersonDay.toString(),
  );
  assert.equal(
    saved.foodServingsPerPersonDay.toString(),
    DEFAULT_DISASTER_PLAN.foodServingsPerPersonDay.toString(),
  );
  assert.equal(
    saved.sanitationUsesPerPersonDay.toString(),
    DEFAULT_DISASTER_PLAN.sanitationUsesPerPersonDay.toString(),
  );
  assert.equal(
    saved.lightingUnitsPerPerson.toString(),
    DEFAULT_DISASTER_PLAN.lightingUnitsPerPerson.toString(),
  );
  assert.equal(
    saved.powerUnitsPerPerson.toString(),
    DEFAULT_DISASTER_PLAN.powerUnitsPerPerson.toString(),
  );
  assert.equal(
    saved.heatSourceUsesPerDay.toString(),
    DEFAULT_DISASTER_PLAN.heatSourceUsesPerDay.toString(),
  );

  // 冷蔵・冷凍・開封済みを数えないのが既定（受入条件の「明示設定なしに例外化しない」）。
  assert.equal(saved.includeChilled, DEFAULT_DISASTER_PLAN.includeChilled);
  assert.equal(saved.includeFrozen, DEFAULT_DISASTER_PLAN.includeFrozen);
  assert.equal(saved.includeOpened, DEFAULT_DISASTER_PLAN.includeOpened);
  assert.equal(
    saved.requireHeatSourceForHeating,
    DEFAULT_DISASTER_PLAN.requireHeatSourceForHeating,
  );
  assert.equal(saved.requireWaterForRehydration, DEFAULT_DISASTER_PLAN.requireWaterForRehydration);
});

test("家庭を消すと、防災の基準も消える", async () => {
  const household = await createHousehold("db-test household（防災の基準の連鎖削除）");

  await prisma.disasterPlanSetting.create({ data: { householdId: household.id } });
  await deleteHousehold(household.id);

  assert.equal(
    await prisma.disasterPlanSetting.count({ where: { householdId: household.id } }),
    0,
  );
});
