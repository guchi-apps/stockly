/**
 * 認証idが変わった同じ本人を、新しい利用者・新しい家庭として扱わないこと（#134）を実DBで確かめる。
 *
 * 判定そのものは`src/lib/auth/account-link.test.ts`（DBなし）が見る。ここで見るのは、
 * 付け替え・家庭の作成・一意制約が実際のDBで噛み合うこと——特に
 * 「エラーは出ないのに新しいUserと家庭ができて旧い在庫が見えなくなる」経路が無いこと。
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";

import { linkStocklyUser, type StocklyUserProfile } from "../src/lib/auth/account-link.ts";
import { findAccountSplits, relinkUserManually } from "../src/lib/auth/account-recovery.ts";
import { createProduct, deleteHousehold, deleteUser, prisma } from "./helpers.ts";

let seq = 0;
function uniqueSuffix(): string {
  seq += 1;
  return `${Date.now().toString(36)}-${seq}-${Math.random().toString(36).slice(2, 6)}`;
}

const createdUserIds = new Set<string>();

after(async () => {
  // 家庭が先（所属の行はCascadeで消える）。テストが作った利用者の家庭を全部集めて消す。
  const memberships = await prisma.householdMember.findMany({
    where: { userId: { in: [...createdUserIds] } },
    select: { householdId: true },
  });
  for (const householdId of new Set(memberships.map((m) => m.householdId))) {
    await deleteHousehold(householdId);
  }
  for (const id of createdUserIds) {
    if (await prisma.user.findUnique({ where: { id } })) await deleteUser(id);
  }
  await prisma.$disconnect();
});

function profileOf(overrides: Partial<StocklyUserProfile> = {}): StocklyUserProfile {
  const suffix = uniqueSuffix();
  return {
    supabaseUserId: `test-auth-${suffix}`,
    googleSubject: `test-google-${suffix}`,
    email: `test-${suffix}@example.invalid`,
    name: "テスト利用者",
    imageUrl: null,
    ...overrides,
  };
}

async function link(profile: StocklyUserProfile) {
  const result = await linkStocklyUser(prisma, profile);
  if (result.status === "ready") createdUserIds.add(result.userId);
  return result;
}

async function activeHouseholdIds(userId: string): Promise<string[]> {
  const rows = await prisma.householdMember.findMany({
    where: { userId, removedAt: null },
    select: { householdId: true },
  });
  return rows.map((row) => row.householdId);
}

/**
 * このテストの利用者（同じメール）に関わるUserと家庭の件数。`node --test`は他のテストファイルを
 * 並行して流すため、表全体の件数では比べられない。家庭は必ず所属つきで作られるので、
 * そのメールのUserが所属する家庭を数えれば「不要な家庭が増えた」を検出できる。
 */
async function countsFor(email: string | null) {
  const where = { email };
  const users = await prisma.user.count({ where });
  const households = await prisma.household.count({ where: { members: { some: { user: where } } } });
  return { users, households };
}

/** 旧い認証idで使っていた利用者を、在庫と履歴つきで用意する。 */
async function seedExistingUser(profile: StocklyUserProfile) {
  const result = await link(profile);
  assert.equal(result.status, "ready");
  const userId = result.userId;
  const [householdId] = await activeHouseholdIds(userId);
  const member = await prisma.householdMember.findFirstOrThrow({ where: { userId, householdId } });

  const product = await createProduct(householdId, `商品-${uniqueSuffix()}`);
  const lot = await prisma.stockLot.create({
    data: { householdId, productId: product.id, unit: "PIECE", quantity: "3" },
  });
  const transaction = await prisma.inventoryTransaction.create({
    data: {
      householdId,
      stockLotId: lot.id,
      productId: product.id,
      memberId: member.id,
      type: "PURCHASE",
      quantityDelta: "3",
      unit: "PIECE",
      occurredAt: new Date(),
    },
  });
  return { userId, householdId, memberId: member.id, lotId: lot.id, transactionId: transaction.id };
}

test("正規の新規利用者は、Userと初期の家庭をOWNERで持てる", async () => {
  const profile = profileOf();
  const result = await link(profile);
  assert.equal(result.status, "ready");
  assert.equal(result.outcome, "create");
  assert.equal(result.createdHousehold, true);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: result.userId } });
  assert.equal(user.googleSubject, profile.googleSubject);
  const members = await prisma.householdMember.findMany({ where: { userId: result.userId } });
  assert.equal(members.length, 1);
  assert.equal(members[0].role, "OWNER");

  // 2回目は家庭を増やさない。
  const again = await link(profile);
  assert.equal(again.status, "ready");
  assert.equal(again.outcome, "existing");
  assert.equal(again.createdHousehold, false);
});

test("認証idが変わっても、Googleのidが同じなら旧い在庫・履歴・所属を引き継ぎ、家庭を増やさない", async () => {
  const before = profileOf();
  const seeded = await seedExistingUser(before);
  const counts = await countsFor(before.email);

  const after = { ...before, supabaseUserId: `test-auth-${uniqueSuffix()}` };
  const result = await link(after);

  assert.equal(result.status, "ready");
  assert.equal(result.outcome, "relink");
  assert.equal(result.userId, seeded.userId, "User.idが保たれていない");
  assert.equal(result.createdHousehold, false);
  assert.deepEqual(await countsFor(before.email), counts, "新しいUser・家庭が作られた");

  const user = await prisma.user.findUniqueOrThrow({ where: { id: seeded.userId } });
  assert.equal(user.supabaseUserId, after.supabaseUserId);
  assert.deepEqual(await activeHouseholdIds(seeded.userId), [seeded.householdId]);
  const member = await prisma.householdMember.findUniqueOrThrow({ where: { id: seeded.memberId } });
  assert.equal(member.role, "OWNER");
  const transaction = await prisma.inventoryTransaction.findUniqueOrThrow({
    where: { id: seeded.transactionId },
  });
  assert.equal(transaction.memberId, seeded.memberId, "履歴の記録者が変わった");
  assert.ok(await prisma.stockLot.findUnique({ where: { id: seeded.lotId } }));

  // 旧いidではもう引けない（同じ本人の旧いセッションが別人として残らない）。
  assert.equal(await prisma.user.findUnique({ where: { supabaseUserId: before.supabaseUserId } }), null);
});

test("Googleのidが未記録の既存利用者は、次のログインで記録される", async () => {
  const profile = profileOf();
  const user = await prisma.user.create({
    data: { supabaseUserId: profile.supabaseUserId, email: profile.email },
  });
  createdUserIds.add(user.id);

  const result = await link(profile);
  assert.equal(result.status, "ready");
  assert.equal(result.outcome, "existing");
  const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(updated.googleSubject, profile.googleSubject);
});

test("照合できず同じメールのUserが居るときは、Userも家庭も作らず復旧へ回す", async () => {
  const existing = profileOf();
  const seeded = await seedExistingUser(existing);
  // Googleのidが未記録だった時代の利用者を想定する（この列が入る前から居る人）。
  await prisma.user.update({ where: { id: seeded.userId }, data: { googleSubject: null } });

  const counts = await countsFor(existing.email);

  // 同じメールで、別の認証id・別のGoogleのid（同じ本人か別人かは分からない）。
  const newcomer = profileOf({ email: existing.email?.toUpperCase() ?? null });
  const result = await link(newcomer);

  assert.deepEqual(result, { status: "recovery_required", reason: "same_email" });
  assert.deepEqual(await countsFor(existing.email), counts);
  assert.equal(
    await prisma.user.findUnique({ where: { supabaseUserId: newcomer.supabaseUserId } }),
    null,
  );
  // 既存の利用者は一切変わらない（メール一致で付け替えない）。
  const user = await prisma.user.findUniqueOrThrow({ where: { id: seeded.userId } });
  assert.equal(user.supabaseUserId, existing.supabaseUserId);

  // 人が本人と確かめて付け替えると、在庫ごと引き継がれる。
  const dryRun = await relinkUserManually(prisma, {
    userId: seeded.userId,
    supabaseUserId: newcomer.supabaseUserId,
    apply: false,
  });
  assert.equal(dryRun.status, "dry_run");
  assert.equal(
    (await prisma.user.findUniqueOrThrow({ where: { id: seeded.userId } })).supabaseUserId,
    existing.supabaseUserId,
    "dry-runなのに書き込んだ",
  );

  const relinked = await relinkUserManually(prisma, {
    userId: seeded.userId,
    supabaseUserId: newcomer.supabaseUserId,
    apply: true,
  });
  assert.equal(relinked.status, "relinked");

  const after = await link(newcomer);
  assert.equal(after.status, "ready");
  assert.equal(after.userId, seeded.userId);
  assert.equal(after.createdHousehold, false);
  assert.deepEqual(await activeHouseholdIds(seeded.userId), [seeded.householdId]);
});

test("修正前に分かれてしまった組は、読み取りの確認で所属・在庫の件数つきで見つかる", async () => {
  const email = `test-split-${uniqueSuffix()}@example.invalid`;
  const seeded = await seedExistingUser(profileOf({ email }));
  // 修正前の経路（supabaseUserIdだけで新設）で、同じメールの2人目と空の家庭ができた状態を作る。
  const split = await prisma.user.create({
    data: { supabaseUserId: `test-auth-${uniqueSuffix()}`, email },
  });
  createdUserIds.add(split.id);
  const emptyHousehold = await prisma.household.create({ data: { name: "分かれた家" } });
  await prisma.householdMember.create({
    data: { householdId: emptyHousehold.id, userId: split.id, role: "OWNER" },
  });
  const counts = await countsFor(email);

  const found = (await findAccountSplits(prisma)).find((s) =>
    s.users.some((u) => u.userId === seeded.userId),
  );
  assert.ok(found, "分かれた組が一覧に出ない");
  assert.ok(!found.maskedEmail.includes(email), "メールが伏せられていない");
  assert.deepEqual(
    found.users.map((u) => u.userId),
    [seeded.userId, split.id],
  );
  const original = found.users[0].memberships[0];
  assert.equal(original.stockLotCount, 1);
  assert.equal(original.transactionCount, 1);
  assert.equal(found.users[1].memberships[0].stockLotCount, 0);
  // 読み取りだけで、何も変えていない。
  assert.deepEqual(await countsFor(email), counts);
});

test("同じメールでも、すでにUserを持つ認証idへの手動の付け替えは断る（何も消さない）", async () => {
  const a = await link(profileOf());
  const b = await link(profileOf());
  assert.equal(a.status, "ready");
  assert.equal(b.status, "ready");
  const bUser = await prisma.user.findUniqueOrThrow({ where: { id: b.userId } });

  const result = await relinkUserManually(prisma, {
    userId: a.userId,
    supabaseUserId: bUser.supabaseUserId,
    apply: true,
  });
  assert.equal(result.status, "supabase_user_in_use");
  assert.ok(await prisma.user.findUnique({ where: { id: b.userId } }));
});

test("同じsupabaseUserIdで覚えているGoogleのidと違うなら、上書きせず復旧へ回す", async () => {
  const profile = profileOf();
  const seeded = await seedExistingUser(profile);

  const result = await link({ ...profile, googleSubject: `test-google-${uniqueSuffix()}` });
  assert.deepEqual(result, { status: "recovery_required", reason: "subject_mismatch" });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: seeded.userId } });
  assert.equal(user.googleSubject, profile.googleSubject);
});

test("除名・脱退した家庭へは、付け替えても戻らない", async () => {
  const before = profileOf();
  const seeded = await seedExistingUser(before);
  await prisma.householdMember.update({
    where: { id: seeded.memberId },
    data: { removedAt: new Date() },
  });

  const result = await link({ ...before, supabaseUserId: `test-auth-${uniqueSuffix()}` });
  assert.equal(result.status, "ready");
  assert.equal(result.outcome, "relink");
  assert.equal(result.userId, seeded.userId);

  const active = await activeHouseholdIds(seeded.userId);
  assert.ok(!active.includes(seeded.householdId), "外れた家庭へ戻った");
  const member = await prisma.householdMember.findUniqueOrThrow({ where: { id: seeded.memberId } });
  assert.notEqual(member.removedAt, null, "除名の印が消えた");
  // 所属が無くなった人には、従来どおり新しい家庭を作る（画面から作る手段が無いため）。
  assert.equal(result.createdHousehold, true);
  assert.equal(active.length, 1);
});

test("同じ本人の新しい認証idでのログインが同時に走っても、Userも家庭も増えない", async () => {
  const before = profileOf();
  const seeded = await seedExistingUser(before);
  const counts = await countsFor(before.email);

  const after = { ...before, supabaseUserId: `test-auth-${uniqueSuffix()}` };
  const results = await Promise.all([link(after), link(after), link(after)]);

  for (const result of results) {
    assert.equal(result.status, "ready");
    assert.equal(result.userId, seeded.userId);
  }
  assert.deepEqual(await countsFor(before.email), counts);
});

test("正規の新規利用者の初回ログインが同時に走っても、家庭は1つだけ", async () => {
  const profile = profileOf();
  const results = await Promise.all([link(profile), link(profile), link(profile)]);
  const userIds = new Set(results.map((r) => (r.status === "ready" ? r.userId : null)));
  assert.equal(userIds.size, 1);
  const [userId] = [...userIds];
  assert.ok(userId);
  assert.equal((await activeHouseholdIds(userId)).length, 1);
});
