/**
 * 家庭とメンバーの読み取り（#12）。
 *
 * 在庫の読み取り（`src/lib/inventory/queries.ts`）と同じ約束で書く。画面から
 * `db.householdMember.findMany()`等を直接呼ばず、必ずここを通す。どの関数も先頭で
 * `scopeToHousehold()`を通し、そこで返った`householdId`だけをwhereに使う。
 *
 * **除名・脱退した人（`removedAt`が入っている行）は一覧に出さない。** 行そのものは
 * 履歴の記録者として残るが、いまの所属ではない。
 */
import { db } from "@/lib/db";
import {
  listAccessibleHouseholdIds,
  scopeToHousehold,
  type HouseholdRoleName,
} from "@/lib/household/access";
import { householdMembershipStore } from "@/lib/household/store";

import { invitationState, type MemberRoleSnapshot } from "./members.ts";

/** 在庫側の`InventoryContext`と同じ形。家庭の操作は在庫に依存しないので別に持つ。 */
export interface HouseholdContext {
  readonly userId: string;
  readonly householdId: string;
}

export async function scopeHousehold(ctx: HouseholdContext): Promise<string> {
  const { householdId } = await scopeToHousehold(
    householdMembershipStore,
    ctx.userId,
    ctx.householdId,
  );
  return householdId;
}

export interface HouseholdMemberRow {
  readonly memberId: string;
  readonly userId: string;
  readonly name: string;
  readonly email: string | null;
  readonly role: HouseholdRoleName;
  readonly joinedAt: Date;
  readonly isViewer: boolean;
}

export interface HouseholdInvitationRow {
  readonly id: string;
  readonly email: string;
  readonly role: HouseholdRoleName;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly invitedByName: string | null;
}

export interface HouseholdOverview {
  readonly householdId: string;
  readonly householdName: string;
  readonly viewerRole: HouseholdRoleName;
  readonly members: readonly HouseholdMemberRow[];
  readonly invitations: readonly HouseholdInvitationRow[];
}

/**
 * `/household`が出すものを1回で揃える。
 *
 * 並びは「オーナーが先、同じ役割なら参加が早い順」。役割で分けて並べるのは、
 * 誰に依頼すれば設定を変えられるかを一覧の先頭で読めるようにするため。
 */
export async function loadHouseholdOverview(ctx: HouseholdContext): Promise<HouseholdOverview> {
  const householdId = await scopeHousehold(ctx);

  const [household, members, invitations] = await Promise.all([
    db.household.findUniqueOrThrow({ where: { id: householdId }, select: { name: true } }),
    db.householdMember.findMany({
      where: { householdId, removedAt: null },
      select: {
        id: true,
        userId: true,
        role: true,
        createdAt: true,
        user: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    db.householdInvitation.findMany({
      where: { householdId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        email: true,
        role: true,
        expiresAt: true,
        createdAt: true,
        invitedBy: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const rows: HouseholdMemberRow[] = members.map((member) => ({
    memberId: member.id,
    userId: member.userId,
    name: member.user.name ?? member.user.email ?? "名前未設定の利用者",
    email: member.user.email,
    role: member.role,
    joinedAt: member.createdAt,
    isViewer: member.userId === ctx.userId,
  }));

  const viewerRole = rows.find((row) => row.isViewer)?.role;
  // `scopeToHousehold()`を通っている以上ここは必ず見つかるが、見つからないまま
  // MEMBERへ寄せると権限を取り違えるので、素直に落とす。
  if (!viewerRole) {
    throw new Error(`所属しているはずのメンバー行が見つかりません（householdId=${householdId}）`);
  }

  return {
    householdId,
    householdName: household.name,
    viewerRole,
    members: [
      ...rows.filter((row) => row.role === "OWNER"),
      ...rows.filter((row) => row.role !== "OWNER"),
    ],
    invitations: invitations.map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
      invitedByName: invitation.invitedBy?.name ?? invitation.invitedBy?.email ?? null,
    })),
  };
}

/** 役割の判定（`members.ts`）へ渡す最小の形。 */
export async function listMemberRoles(householdId: string): Promise<MemberRoleSnapshot[]> {
  const members = await db.householdMember.findMany({
    where: { householdId, removedAt: null },
    select: { userId: true, role: true },
  });
  return members;
}

/**
 * 招待をトークンから引く（`/invitations/[token]`用）。
 *
 * **この1本だけは`scopeToHousehold()`を通さない。** 受け入れる人はまだその家庭に所属して
 * おらず、所属を条件にすると誰も招待を開けないため。代わりに引き当てのキーが
 * トークンのハッシュそのもので、状態と宛先の判定は`checkInvitationAcceptable()`が行う。
 */
export async function findInvitationByTokenHash(tokenHash: string) {
  return db.householdInvitation.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      householdId: true,
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      household: { select: { name: true } },
      invitedBy: { select: { name: true, email: true } },
    },
  });
}

export type InvitationDetail = NonNullable<Awaited<ReturnType<typeof findInvitationByTokenHash>>>;

/** 招待の状態を画面用のラベルへ落とすときに使う。 */
export function stateOfInvitation(invitation: InvitationDetail, now: Date = new Date()) {
  return invitationState(invitation, now);
}

/**
 * その利用者が所属している家庭の一覧（切り替え用。#12）。
 *
 * 名前を出すだけなので在庫には触れない。**所属している家庭に限るのは`where`ではなく
 * `listAccessibleHouseholdIds()`の結果**で、ここで家庭のidを組み立てない。
 */
export async function listMyHouseholds(userId: string) {
  const householdIds = await listAccessibleHouseholdIds(householdMembershipStore, userId);
  if (householdIds.length === 0) return [];

  const households = await db.household.findMany({
    where: { id: { in: householdIds } },
    select: { id: true, name: true },
  });

  // 並びは所属した順（`listAccessibleHouseholdIds()`が古い順に返す）に揃える。
  return householdIds.flatMap((id) => households.filter((household) => household.id === id));
}
