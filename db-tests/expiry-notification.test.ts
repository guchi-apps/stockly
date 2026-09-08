/**
 * 期限の設定と通知の記録（#5）が、実DB上で意図どおりの制約を持っていることを確認する。
 *
 * 特に**重複通知の防止はアプリ側のif文ではなく`NotificationDelivery`の一意制約そのもの**なので、
 * 制約が消えても純関数の単体テストでは気付けない。ここで実際にINSERTして確かめる。
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";

import { createHousehold, deleteHousehold, isUniqueViolation, prisma } from "./helpers.ts";

const createdHouseholdIds: string[] = [];

after(async () => {
  for (const id of createdHouseholdIds) {
    await deleteHousehold(id);
  }
  await prisma.$disconnect();
});

function delivery(householdId: string, dedupeKey: string) {
  return {
    householdId,
    kind: "EXPIRY" as const,
    channel: "IN_APP" as const,
    dedupeKey,
    title: "期限切れ1件",
    body: "木綿豆腐（2日超過）",
  };
}

test("同じ家庭・同じ送り先へ、同じ内容の通知を二重に記録できない", async () => {
  const household = await createHousehold("db-test household（通知の重複防止）");
  createdHouseholdIds.push(household.id);

  await prisma.notificationDelivery.create({ data: delivery(household.id, "expiry:same") });

  await assert.rejects(
    () => prisma.notificationDelivery.create({ data: delivery(household.id, "expiry:same") }),
    isUniqueViolation,
  );
});

test("送り先が違えば、同じ内容でもそれぞれ記録できる", async () => {
  const household = await createHousehold("db-test household（送り先ごとの記録）");
  createdHouseholdIds.push(household.id);

  await prisma.notificationDelivery.create({ data: delivery(household.id, "expiry:per-channel") });
  await prisma.notificationDelivery.create({
    data: { ...delivery(household.id, "expiry:per-channel"), channel: "LOG" },
  });

  const count = await prisma.notificationDelivery.count({
    where: { householdId: household.id, dedupeKey: "expiry:per-channel" },
  });
  assert.equal(count, 2);
});

test("別の家庭は、同じ判定キーの通知を独立して持てる", async () => {
  const first = await createHousehold("db-test household（通知キーの独立性A）");
  const second = await createHousehold("db-test household（通知キーの独立性B）");
  createdHouseholdIds.push(first.id, second.id);

  await prisma.notificationDelivery.create({ data: delivery(first.id, "expiry:shared-key") });
  await prisma.notificationDelivery.create({ data: delivery(second.id, "expiry:shared-key") });

  const rows = await prisma.notificationDelivery.findMany({
    where: { dedupeKey: "expiry:shared-key" },
    select: { householdId: true },
  });
  assert.deepEqual(new Set(rows.map((row) => row.householdId)), new Set([first.id, second.id]));
});

test("期限の設定は1家庭に1件しか持てない", async () => {
  const household = await createHousehold("db-test household（期限の設定）");
  createdHouseholdIds.push(household.id);

  await prisma.expirySetting.create({ data: { householdId: household.id } });

  await assert.rejects(
    () => prisma.expirySetting.create({ data: { householdId: household.id } }),
    isUniqueViolation,
  );

  // 既定値（賞味7日・消費3日）はDB側にも入れてある。設定行が無い家庭と同じ判定になる。
  const setting = await prisma.expirySetting.findUniqueOrThrow({
    where: { householdId: household.id },
  });
  assert.equal(setting.bestBeforeSoonDays, 7);
  assert.equal(setting.useBySoonDays, 3);
  assert.equal(setting.notifyEnabled, true);
});

test("家庭を消すと、期限の設定と通知の記録も消える", async () => {
  const household = await createHousehold("db-test household（家庭の削除で連鎖）");

  await prisma.expirySetting.create({ data: { householdId: household.id } });
  await prisma.notificationDelivery.create({ data: delivery(household.id, "expiry:cascade") });

  await deleteHousehold(household.id);

  assert.equal(
    await prisma.notificationDelivery.count({ where: { householdId: household.id } }),
    0,
  );
  assert.equal(await prisma.expirySetting.count({ where: { householdId: household.id } }), 0);
});
