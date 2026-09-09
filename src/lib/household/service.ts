/**
 * 家庭の共有を変える処理（#12）。**家庭・メンバー・招待を書き換えるのはこのファイルだけ。**
 *
 * 在庫側（`src/lib/inventory/service.ts`）と同じ約束で書く。
 *
 * - どの関数も先頭で`scopeToHousehold()`を通し、そこで返った`householdId`だけを使う
 * - 家庭そのものを変える操作（招待・除名・役割の変更・家庭名の変更）は、そのうえで
 *   `assertCanManageMembers()`でOWNERを要求する。**画面がボタンを出さないことは担保ではない**
 * - 「最後のオーナーがいなくなる」変更は`members.ts`の純関数が拒む。判定はそちらに閉じ、
 *   ここはDBの読み書きだけを持つ
 */
import { db } from "@/lib/db";
import { requireHouseholdAccess } from "@/lib/household/access";
import { householdMembershipStore } from "@/lib/household/store";

import {
  assertCanManageMembers,
  assertLeaveAllowed,
  assertRemovalAllowed,
  assertRoleChangeAllowed,
  checkInvitationAcceptable,
  hashInvitationToken,
  HouseholdInputError,
  invitationExpiresAt,
  newInvitationToken,
  normalizeInviteEmail,
  parseHouseholdName,
  type MemberRoleSnapshot,
} from "./members.ts";
import { findInvitationByTokenHash, listMemberRoles, type HouseholdContext } from "./queries.ts";

import type { HouseholdRoleName } from "@/lib/household/access";

/** 所属を確かめ、そのうえでOWNERを要求する。オーナー専用の操作はすべてここを通る。 */
async function scopeAsOwner(ctx: HouseholdContext): Promise<string> {
  const membership = await requireHouseholdAccess(
    householdMembershipStore,
    ctx.userId,
    ctx.householdId,
  );
  assertCanManageMembers(membership.role);
  return membership.householdId;
}

async function scopeAsMember(ctx: HouseholdContext): Promise<string> {
  const membership = await requireHouseholdAccess(
    householdMembershipStore,
    ctx.userId,
    ctx.householdId,
  );
  return membership.householdId;
}

// ---------------------------------------------------------------------------
// 家庭
// ---------------------------------------------------------------------------

export async function renameHousehold(ctx: HouseholdContext, rawName: string): Promise<string> {
  const householdId = await scopeAsOwner(ctx);
  const name = parseHouseholdName(rawName);

  await db.household.update({ where: { id: householdId }, data: { name } });
  return name;
}

// ---------------------------------------------------------------------------
// メンバー
// ---------------------------------------------------------------------------

export interface MemberChangeResult {
  readonly targetName: string;
  readonly role: HouseholdRoleName;
}

/** 役割を変える。オーナーが0人になる変更は`assertRoleChangeAllowed()`が拒む。 */
export async function changeMemberRole(
  ctx: HouseholdContext,
  params: { readonly targetUserId: string; readonly role: HouseholdRoleName },
): Promise<MemberChangeResult> {
  const householdId = await scopeAsOwner(ctx);
  const members = await listMemberRoles(householdId);
  assertRoleChangeAllowed(members, params.targetUserId, params.role);

  const updated = await db.householdMember.updateMany({
    where: { householdId, userId: params.targetUserId, removedAt: null },
    data: { role: params.role },
  });
  if (updated.count === 0) {
    throw new HouseholdInputError("その人はこの家庭のメンバーではありません。");
  }

  return { targetName: await memberName(householdId, params.targetUserId), role: params.role };
}

/**
 * メンバーを家庭から外す。
 *
 * **行は消さず`removedAt`を入れる。** 入出庫履歴が`[householdId, memberId]`でこの行を
 * 記録者として参照しており（`onDelete: Restrict`）、消すと履歴から「誰が記録したか」が
 * 消えるうえ、履歴を持つ人はそもそもDBが消させてくれない。所属の判定は`store.ts`が
 * `removedAt: null`で行うので、印を入れた時点でその家庭の在庫へは到達できなくなる。
 */
export async function removeMember(
  ctx: HouseholdContext,
  params: { readonly targetUserId: string },
): Promise<{ readonly targetName: string }> {
  const householdId = await scopeAsOwner(ctx);
  const members = await listMemberRoles(householdId);
  assertRemovalAllowed(members, params.targetUserId, ctx.userId);

  const targetName = await memberName(householdId, params.targetUserId);
  const removed = await db.householdMember.updateMany({
    where: { householdId, userId: params.targetUserId, removedAt: null },
    data: { removedAt: new Date() },
  });
  if (removed.count === 0) {
    throw new HouseholdInputError("その人はこの家庭のメンバーではありません。");
  }

  return { targetName };
}

/** 自分がこの家庭から抜ける。最後のオーナーは抜けられない（`assertLeaveAllowed()`）。 */
export async function leaveHousehold(
  ctx: HouseholdContext,
): Promise<{ readonly householdName: string }> {
  const householdId = await scopeAsMember(ctx);
  const members = await listMemberRoles(householdId);
  assertLeaveAllowed(members, ctx.userId);

  const household = await db.household.findUniqueOrThrow({
    where: { id: householdId },
    select: { name: true },
  });

  await db.householdMember.updateMany({
    where: { householdId, userId: ctx.userId, removedAt: null },
    data: { removedAt: new Date() },
  });

  return { householdName: household.name };
}

async function memberName(householdId: string, userId: string): Promise<string> {
  const member = await db.householdMember.findFirst({
    where: { householdId, userId },
    select: { user: { select: { name: true, email: true } } },
  });
  return member?.user.name ?? member?.user.email ?? "その人";
}

// ---------------------------------------------------------------------------
// 招待
// ---------------------------------------------------------------------------

export interface CreatedInvitation {
  readonly id: string;
  readonly email: string;
  readonly role: HouseholdRoleName;
  readonly expiresAt: Date;
  /** **平文のトークン。DBには残らないので、この戻り値でしか受け取れない。** */
  readonly token: string;
}

/**
 * 招待リンクを発行する。
 *
 * 同じ宛先の保留中の招待は先に取り消す。**1つの宛先に有効なリンクを2本持たせない**ためで、
 * 持たせると「古いほうを渡してしまった」ときに取り消したはずのリンクが通る。
 */
export async function createInvitation(
  ctx: HouseholdContext,
  params: { readonly email: string; readonly role: HouseholdRoleName },
): Promise<CreatedInvitation> {
  const householdId = await scopeAsOwner(ctx);
  const email = normalizeInviteEmail(params.email);

  await assertNotAlreadyMember(householdId, email);

  const token = newInvitationToken();
  const expiresAt = invitationExpiresAt();

  const invitation = await db.$transaction(async (tx) => {
    await tx.householdInvitation.updateMany({
      where: { householdId, email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return tx.householdInvitation.create({
      data: {
        householdId,
        email,
        role: params.role,
        tokenHash: hashInvitationToken(token),
        expiresAt,
        invitedByUserId: ctx.userId,
      },
      select: { id: true, email: true, role: true, expiresAt: true },
    });
  });

  return { ...invitation, token };
}

/** すでにメンバーの人を招待させない（受け入れても何も起きないリンクができるだけ）。 */
async function assertNotAlreadyMember(householdId: string, email: string): Promise<void> {
  const existing = await db.householdMember.findFirst({
    where: { householdId, removedAt: null, user: { email } },
    select: { id: true },
  });
  if (existing) {
    throw new HouseholdInputError("その人はすでにこの家庭のメンバーです。");
  }
}

export async function revokeInvitation(
  ctx: HouseholdContext,
  params: { readonly invitationId: string },
): Promise<{ readonly email: string }> {
  const householdId = await scopeAsOwner(ctx);

  // idは画面から渡るため、必ず`{ id, householdId }`の組で引く（他家庭の招待を取り消させない）。
  const invitation = await db.householdInvitation.findFirst({
    where: { householdId, id: params.invitationId },
    select: { id: true, email: true },
  });
  if (!invitation) {
    throw new HouseholdInputError("その招待は見つかりませんでした。画面を開き直してください。");
  }

  await db.householdInvitation.updateMany({
    where: { householdId, id: invitation.id, acceptedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  return { email: invitation.email };
}

export interface AcceptInvitationResult {
  readonly householdId: string;
  readonly householdName: string;
}

/**
 * 招待を受け入れて家庭に参加する。
 *
 * 受け入れる人はまだ所属していないので`scopeToHousehold()`は通らない。代わりに
 * 「トークンのハッシュで引けること」「宛先のメールアドレスと一致すること」「状態が保留中で
 * あること」の3つで絞る（判定は`checkInvitationAcceptable()`）。
 *
 * **受け入れの印はトランザクションの中で条件付きに立てる。** 同じリンクを2つの端末から
 * 同時に開いても、`acceptedAt`が入っていない行を更新できたほうだけが先へ進む。
 */
export async function acceptInvitation(params: {
  readonly userId: string;
  readonly token: string;
}): Promise<AcceptInvitationResult> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: params.userId },
    select: { id: true, email: true },
  });

  const invitation = await findInvitationByTokenHash(hashInvitationToken(params.token));
  if (!invitation) {
    throw new HouseholdInputError("この招待リンクは見つかりませんでした。");
  }

  const alreadyMember = await db.householdMember.findFirst({
    where: { householdId: invitation.householdId, userId: user.id, removedAt: null },
    select: { id: true },
  });

  const check = checkInvitationAcceptable(invitation, user.email, alreadyMember !== null);
  if (!check.ok) throw new HouseholdInputError(check.message);

  await db.$transaction(async (tx) => {
    const claimed = await tx.householdInvitation.updateMany({
      where: {
        id: invitation.id,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { acceptedAt: new Date() },
    });
    if (claimed.count !== 1) {
      throw new HouseholdInputError("この招待はすでに使われています。");
    }

    // 一度外れた人が招待され直した場合は、行を作らずに`removedAt`を消して戻す
    // （行を作ると`@@unique([householdId, userId])`に当たる）。
    const restored = await tx.householdMember.updateMany({
      where: { householdId: invitation.householdId, userId: user.id },
      data: { removedAt: null, role: invitation.role },
    });
    if (restored.count === 0) {
      await tx.householdMember.create({
        data: {
          householdId: invitation.householdId,
          userId: user.id,
          role: invitation.role,
        },
      });
    }
  });

  return { householdId: invitation.householdId, householdName: invitation.household.name };
}

export type { MemberRoleSnapshot };
