/**
 * 家庭内共有（#12）が置いたDB側の担保を、実DBで確かめる。
 *
 * ここで見ているのは次の3つ。どれもアプリ側の判定（`src/lib/household/members.ts`）とは別に、
 * スキーマを崩したときにだけ落ちる。
 *
 * 1. 同じ家庭に同じ利用者が二重に所属しないこと（`@@unique([householdId, userId])`）
 * 2. 除名で行を消さない設計が成り立つこと——外れた印が入っていても行は残るので、
 *    復帰は「INSERTし直す」ではなく「`removedAt`を消す」でなければならない
 * 3. 招待が家庭に紐づき、同じトークンのハッシュを2件持てないこと
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";

import {
  assertRejectedByDatabase,
  createHousehold,
  createUser,
  deleteHousehold,
  deleteUser,
  isUniqueViolation,
  prisma,
} from "./helpers.ts";

const createdHouseholdIds: string[] = [];
const createdUserIds: string[] = [];

let seq = 0;
function uniqueSuffix(): string {
  seq += 1;
  return `${Date.now().toString(36)}-${seq}`;
}

after(async () => {
  // 家庭が先。所属の行は家庭側のCascadeで消える。
  for (const id of createdHouseholdIds) await deleteHousehold(id);
  for (const id of createdUserIds) await deleteUser(id);
  await prisma.$disconnect();
});

async function household(name: string) {
  const created = await createHousehold(name);
  createdHouseholdIds.push(created.id);
  return created;
}

async function user(label: string) {
  const created = await createUser(`db-test-${label}-${uniqueSuffix()}`, `${label}@example.invalid`);
  createdUserIds.push(created.id);
  return created;
}

test("同じ家庭に同じ利用者を二重に所属させられない", async () => {
  const home = await household("db-test household（二重所属）");
  const member = await user("dup");

  await prisma.householdMember.create({
    data: { householdId: home.id, userId: member.id, role: "OWNER" },
  });

  await assertRejectedByDatabase(
    () =>
      prisma.householdMember.create({
        data: { householdId: home.id, userId: member.id, role: "MEMBER" },
      }),
    () => prisma.householdMember.count({ where: { householdId: home.id } }),
  );
});

test("外れた印が入っていても所属の行は残る（復帰はINSERTではなく更新で行う）", async () => {
  const home = await household("db-test household（除名と復帰）");
  const member = await user("rejoin");

  await prisma.householdMember.create({
    data: { householdId: home.id, userId: member.id, role: "MEMBER" },
  });

  // 除名＝行を消さずに印を入れる（履歴が記録者としてこの行を参照しているため）。
  await prisma.householdMember.updateMany({
    where: { householdId: home.id, userId: member.id },
    data: { removedAt: new Date() },
  });

  // 印が入っていても一意制約は効いたままなので、招待され直したときにINSERTすると落ちる。
  // `service.ts`の`acceptInvitation()`が「まず更新、無ければ作成」の順にしているのはこのため。
  let rejected = false;
  try {
    await prisma.householdMember.create({
      data: { householdId: home.id, userId: member.id, role: "MEMBER" },
    });
  } catch (error) {
    rejected = isUniqueViolation(error);
  }
  assert.ok(rejected, "外れた行があるのにINSERTが通った（一意制約が消えている）");

  const restored = await prisma.householdMember.updateMany({
    where: { householdId: home.id, userId: member.id },
    data: { removedAt: null, role: "OWNER" },
  });
  assert.equal(restored.count, 1);

  const active = await prisma.householdMember.findFirst({
    where: { householdId: home.id, userId: member.id, removedAt: null },
    select: { role: true },
  });
  assert.equal(active?.role, "OWNER");
});

test("存在しない家庭を参照する招待はINSERTできない", async () => {
  await assertRejectedByDatabase(
    () =>
      prisma.householdInvitation.create({
        data: {
          householdId: "no-such-household",
          email: "someone@example.invalid",
          tokenHash: "a".repeat(64),
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
    () => prisma.householdInvitation.count({ where: { householdId: "no-such-household" } }),
  );
});

test("同じトークンのハッシュで招待を2件持てない（家庭が違っても）", async () => {
  const first = await household("db-test household（招待A）");
  const second = await household("db-test household（招待B）");
  const tokenHash = `b${uniqueSuffix()}`.padEnd(64, "0").slice(0, 64);

  await prisma.householdInvitation.create({
    data: {
      householdId: first.id,
      email: "invitee@example.invalid",
      tokenHash,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });

  await assertRejectedByDatabase(
    () =>
      prisma.householdInvitation.create({
        data: {
          householdId: second.id,
          email: "invitee@example.invalid",
          tokenHash,
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
    () => prisma.householdInvitation.count({ where: { tokenHash } }),
  );
});

test("家庭を消すと、その家庭の招待と所属も消える", async () => {
  const home = await createHousehold("db-test household（消す）");
  const member = await user("cascade");

  await prisma.householdMember.create({
    data: { householdId: home.id, userId: member.id, role: "OWNER" },
  });
  await prisma.householdInvitation.create({
    data: {
      householdId: home.id,
      email: "invitee@example.invalid",
      tokenHash: `c${uniqueSuffix()}`.padEnd(64, "0").slice(0, 64),
      expiresAt: new Date(Date.now() + 60_000),
      invitedByUserId: member.id,
    },
  });

  await deleteHousehold(home.id);

  assert.equal(await prisma.householdMember.count({ where: { householdId: home.id } }), 0);
  assert.equal(await prisma.householdInvitation.count({ where: { householdId: home.id } }), 0);
});
