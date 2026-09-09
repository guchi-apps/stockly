/**
 * 写真取込（#10）が足したモデルでも、他家庭のデータを参照できないことを実DBで確かめる。
 *
 * 新しいモデルを足すときは`[householdId, 親Id]`の複合外部キーに揃える約束
 * （CLAUDE.md「データモデル」）で、単一列の外部キーへ書き換えてもアプリは動いてしまうため、
 * ここで実際にINSERTして拒否されることを確かめる（`household-boundary.test.ts`と同じ狙い）。
 *
 * あわせて、**同じ画像を2回取り込めないこと**（受入条件の二重登録の防止）も確かめる。
 * この保証は`@@unique([householdId, sha256])`だけが持っており、アプリ側の事前チェックは
 * 競合したときの取りこぼしを埋められない。
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";

import {
  assertRejectedByDatabase,
  createHousehold,
  createStorageLocation,
  createStoragePosition,
  deleteHousehold,
  isUniqueViolation,
  prisma,
} from "./helpers.ts";

const createdHouseholdIds: string[] = [];

after(async () => {
  for (const id of createdHouseholdIds) {
    // 取り込みは家庭のCascadeで消えるが、順序に頼らず先に消しておく。
    await prisma.intakeCandidate.deleteMany({ where: { householdId: id } });
    await prisma.intakeImage.deleteMany({ where: { householdId: id } });
    await prisma.intakeBatch.deleteMany({ where: { householdId: id } });
    await deleteHousehold(id);
  }
  await prisma.$disconnect();
});

function createBatch(householdId: string) {
  return prisma.intakeBatch.create({
    data: { householdId, model: "claude-sonnet-5", promptVersion: "v1" },
  });
}

function imageData(householdId: string, batchId: string, sha256: string) {
  return { householdId, batchId, sha256, mimeType: "image/jpeg", byteSize: 1 };
}

test("他家庭の取り込みを参照するIntakeImageはINSERTできない", async () => {
  const owner = await createHousehold("db-test household（取り込みの所有側・画像）");
  const intruder = await createHousehold("db-test household（越境しようとする側・画像）");
  createdHouseholdIds.push(owner.id, intruder.id);

  const batch = await createBatch(owner.id);

  await assertRejectedByDatabase(
    () => prisma.intakeImage.create({ data: imageData(intruder.id, batch.id, "a".repeat(64)) }),
    () => prisma.intakeImage.count({ where: { householdId: intruder.id } }),
  );
});

test("他家庭の取り込みを参照するIntakeCandidateはINSERTできない", async () => {
  const owner = await createHousehold("db-test household（取り込みの所有側・候補）");
  const intruder = await createHousehold("db-test household（越境しようとする側・候補）");
  createdHouseholdIds.push(owner.id, intruder.id);

  const batch = await createBatch(owner.id);

  await assertRejectedByDatabase(
    () =>
      prisma.intakeCandidate.create({
        data: { householdId: intruder.id, batchId: batch.id, productName: "越境" },
      }),
    () => prisma.intakeCandidate.count({ where: { householdId: intruder.id } }),
  );
});

test("他家庭の保管場所を参照するIntakeCandidateはINSERTできない", async () => {
  const owner = await createHousehold("db-test household（保管場所の所有側・候補）");
  const intruder = await createHousehold("db-test household（越境しようとする側・保管場所）");
  createdHouseholdIds.push(owner.id, intruder.id);

  const batch = await createBatch(intruder.id);
  const storageLocation = await createStorageLocation(owner.id, "他家庭の保管場所");

  await assertRejectedByDatabase(
    () =>
      prisma.intakeCandidate.create({
        data: {
          householdId: intruder.id,
          batchId: batch.id,
          productName: "越境",
          storageLocationId: storageLocation.id,
        },
      }),
    () => prisma.intakeCandidate.count({ where: { householdId: intruder.id } }),
  );
});

test("指定した保管場所の配下にない詳細位置は、IntakeCandidateから参照できない", async () => {
  const household = await createHousehold("db-test household（詳細位置の組み合わせ・候補）");
  createdHouseholdIds.push(household.id);

  const batch = await createBatch(household.id);
  const pantry = await createStorageLocation(household.id, "食品棚");
  const fridge = await createStorageLocation(household.id, "冷蔵庫");
  // 「冷蔵庫のドアポケット」を「食品棚」の詳細位置として参照させる。
  const doorPocket = await createStoragePosition(household.id, fridge.id, "ドアポケット");

  await assertRejectedByDatabase(
    () =>
      prisma.intakeCandidate.create({
        data: {
          householdId: household.id,
          batchId: batch.id,
          productName: "組み合わせが不正",
          storageLocationId: pantry.id,
          storagePositionId: doorPocket.id,
        },
      }),
    () => prisma.intakeCandidate.count({ where: { householdId: household.id } }),
  );
});

test("同じ家庭で同じ画像を2回取り込めない（二重登録の防止）", async () => {
  const household = await createHousehold("db-test household（同じ画像の再送）");
  createdHouseholdIds.push(household.id);

  const first = await createBatch(household.id);
  const second = await createBatch(household.id);
  const sha256 = "b".repeat(64);

  await prisma.intakeImage.create({ data: imageData(household.id, first.id, sha256) });

  let error: unknown;
  try {
    await prisma.intakeImage.create({ data: imageData(household.id, second.id, sha256) });
  } catch (caught) {
    error = caught;
  }

  assert.ok(isUniqueViolation(error), `一意制約で拒否されなかった: ${String(error)}`);
  assert.equal(await prisma.intakeImage.count({ where: { householdId: household.id } }), 1);
});

test("別の家庭でなら、同じ画像を取り込める（家庭をまたいで縛らない）", async () => {
  const first = await createHousehold("db-test household（同じ画像・家庭A）");
  const second = await createHousehold("db-test household（同じ画像・家庭B）");
  createdHouseholdIds.push(first.id, second.id);

  const sha256 = "c".repeat(64);
  const batchA = await createBatch(first.id);
  const batchB = await createBatch(second.id);

  await prisma.intakeImage.create({ data: imageData(first.id, batchA.id, sha256) });
  await prisma.intakeImage.create({ data: imageData(second.id, batchB.id, sha256) });

  assert.equal(await prisma.intakeImage.count({ where: { sha256 } }), 2);
});
