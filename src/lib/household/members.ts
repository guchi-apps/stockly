/**
 * 家庭の中の役割（OWNER / MEMBER）と、招待の判定（#12）。
 *
 * **データの境界と役割は別物。** どの家庭のデータへ到達できるかは所属の有無だけで決まり
 * （`access.ts`）、ここが決めるのは「家庭そのものを変える操作」——招待・除名・役割の変更・
 * 家庭名の変更——を誰ができるかである。前者を緩めることはこのファイルではできない。
 *
 * PrismaにもNext.jsにも依存しない純関数だけを置く。DBを触る処理は`service.ts`にあり、
 * 画面から呼ばれる前に必ずここの`assert*()`を通る。**画面がボタンを出さないことは担保にならない**
 * （フォームは誰でも直接送れる）ので、判定はサーバー側のこの関数に集約する。
 */
import { createHash, randomBytes } from "node:crypto";

import type { HouseholdRoleName } from "./access.ts";

export const HOUSEHOLD_ROLES: readonly HouseholdRoleName[] = ["OWNER", "MEMBER"];

export const HOUSEHOLD_ROLE_LABELS: Record<HouseholdRoleName, string> = {
  OWNER: "オーナー",
  MEMBER: "メンバー",
};

/** 役割ごとにできることの説明。画面と、拒否したときのメッセージで同じ文言を使う。 */
export const HOUSEHOLD_ROLE_NOTES: Record<HouseholdRoleName, string> = {
  OWNER: "メンバーの招待・除名・役割の変更・家庭名の変更ができます",
  MEMBER: "在庫の記録・編集・閲覧ができます",
};

/** 入力（メールアドレス・役割・トークン）が受け取れない形だったとき。 */
export class HouseholdInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HouseholdInputError";
  }
}

/**
 * 役割が足りない操作を呼ばれたとき。
 *
 * `HouseholdAccessError`（そもそも他家庭）とは別にしてある。前者は「見えてはいけない」、
 * こちらは「見えてよいが変えてはいけない」で、画面に出す文言も違うため。
 */
export class HouseholdPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HouseholdPermissionError";
  }
}

// ---------------------------------------------------------------------------
// 役割
// ---------------------------------------------------------------------------

/** 役割の判定に要る最小の形。DBの行をそのまま渡さずにこの形へ落として使う。 */
export type MemberRoleSnapshot = {
  readonly userId: string;
  readonly role: HouseholdRoleName;
};

export function isHouseholdRole(value: unknown): value is HouseholdRoleName {
  return typeof value === "string" && (HOUSEHOLD_ROLES as readonly string[]).includes(value);
}

/** フォームから来た役割を読む。知らない値は落とす（既定へ寄せると、こっそり昇格しうる）。 */
export function parseHouseholdRole(raw: string | null | undefined): HouseholdRoleName {
  const value = (raw ?? "").trim();
  if (!isHouseholdRole(value)) {
    throw new HouseholdInputError("役割は「オーナー」か「メンバー」から選んでください。");
  }
  return value;
}

/** 家庭そのものを変える操作（招待・除名・役割の変更・家庭名の変更）を行えるか。 */
export function canManageMembers(role: HouseholdRoleName): boolean {
  return role === "OWNER";
}

export function assertCanManageMembers(role: HouseholdRoleName): void {
  if (canManageMembers(role)) return;
  throw new HouseholdPermissionError(
    "この操作はオーナーだけが行えます。家庭のオーナーに依頼してください。",
  );
}

export function countOwners(members: readonly MemberRoleSnapshot[]): number {
  return members.filter((member) => member.role === "OWNER").length;
}

function findMember(
  members: readonly MemberRoleSnapshot[],
  userId: string,
): MemberRoleSnapshot {
  const member = members.find((candidate) => candidate.userId === userId);
  if (!member) {
    throw new HouseholdInputError("その人はこの家庭のメンバーではありません。");
  }
  return member;
}

/**
 * 役割を変えてよいか。
 *
 * **オーナーが0人になる変更を拒む。** 0人になると招待も除名も誰にもできなくなり、
 * 画面からは直せない状態（DBを直接触るしかない）になるため。
 */
export function assertRoleChangeAllowed(
  members: readonly MemberRoleSnapshot[],
  targetUserId: string,
  nextRole: HouseholdRoleName,
): void {
  const target = findMember(members, targetUserId);
  if (target.role === nextRole) return;

  if (target.role === "OWNER" && countOwners(members) <= 1) {
    throw new HouseholdInputError(
      "オーナーがいなくなるため、この人をメンバーにできません。先に別の人をオーナーにしてください。",
    );
  }
}

/**
 * 除名してよいか。
 *
 * 自分自身は除名ではなく脱退（`assertLeaveAllowed()`）で抜ける。同じ結果に見えるが、
 * 「外された」と「自分で抜けた」は画面に出す文言も、押す場所も別にしたい。
 */
export function assertRemovalAllowed(
  members: readonly MemberRoleSnapshot[],
  targetUserId: string,
  actorUserId: string,
): void {
  const target = findMember(members, targetUserId);

  if (targetUserId === actorUserId) {
    throw new HouseholdInputError(
      "自分を外すときは「この家庭から抜ける」を使ってください。",
    );
  }

  if (target.role === "OWNER" && countOwners(members) <= 1) {
    throw new HouseholdInputError(
      "オーナーがいなくなるため、この人を外せません。先に別の人をオーナーにしてください。",
    );
  }
}

/**
 * 自分がこの家庭から抜けられない理由。抜けてよければ`null`。
 *
 * 画面（ボタンを出すか・理由を出すか）と`assertLeaveAllowed()`の両方がこれを使う。
 * 判定を2か所に書くと、画面ではボタンが出るのにサーバーが断る、という食い違いが出る。
 *
 * 止める理由は2つ。**最後のひとり**（誰も所属しない家庭が残ると、在庫も履歴も誰からも
 * 触れなくなる。役割は関係ない）と、**最後のオーナー**（招待も除名も誰にもできない家庭に
 * なり、画面からは直せない）。
 */
export function describeLeaveBlock(
  members: readonly MemberRoleSnapshot[],
  actorUserId: string,
): string | null {
  const actor = findMember(members, actorUserId);

  if (members.length <= 1) {
    return "あなたひとりの家庭からは抜けられません。抜けると在庫を誰も見られなくなります。";
  }
  if (actor.role === "OWNER" && countOwners(members) <= 1) {
    return "オーナーがいなくなるため抜けられません。先に別の人をオーナーにしてください。";
  }
  return null;
}

export function assertLeaveAllowed(
  members: readonly MemberRoleSnapshot[],
  actorUserId: string,
): void {
  const reason = describeLeaveBlock(members, actorUserId);
  if (reason) throw new HouseholdInputError(reason);
}

/** 家庭の名前。空にすると画面のどこにも出せなくなるため、1文字以上を要求する。 */
export function parseHouseholdName(raw: string | null | undefined): string {
  const name = (raw ?? "").trim();
  if (name.length === 0) throw new HouseholdInputError("家庭の名前を入力してください。");
  if (name.length > 60) throw new HouseholdInputError("家庭の名前は60文字までです。");
  return name;
}

// ---------------------------------------------------------------------------
// 招待
// ---------------------------------------------------------------------------

/** 招待リンクの有効期間。長くすると、渡し損ねたリンクが残り続ける。 */
export const INVITATION_TTL_DAYS = 7;

/**
 * 宛先のメールアドレスを正す。
 *
 * **小文字へ揃えてから保存・比較する。** Googleアカウントの表示は大文字を含みうるので、
 * 揃えないと「宛先と違うアカウント」と誤判定して受け入れられなくなる。
 */
export function normalizeInviteEmail(raw: string | null | undefined): string {
  const email = (raw ?? "").trim().toLowerCase();
  if (email.length === 0) {
    throw new HouseholdInputError("招待する人のメールアドレスを入力してください。");
  }
  if (email.length > 191) {
    throw new HouseholdInputError("メールアドレスが長すぎます。");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HouseholdInputError("メールアドレスの形式が正しくありません。");
  }
  return email;
}

/** 比較用。ログイン中の利用者のメールアドレスは未設定でありうるのでnullを許す。 */
export function normalizeEmailForCompare(raw: string | null | undefined): string | null {
  const email = (raw ?? "").trim().toLowerCase();
  return email.length > 0 ? email : null;
}

/**
 * 招待リンクのトークン。URLのパスにそのまま置けるようbase64urlにする。
 * 32バイト＝推測できない長さで、短縮も再利用もしない。
 */
export function newInvitationToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * 保存するのはこのハッシュだけ。**平文はDBに残さない**ので、DBが漏れてもリンクにはならない。
 * 引き当ては「受け取ったトークンをハッシュして一意キーで引く」形で行う。
 */
export function hashInvitationToken(token: string): string {
  const value = (token ?? "").trim();
  if (value.length === 0) throw new HouseholdInputError("招待リンクが正しくありません。");
  return createHash("sha256").update(value).digest("hex");
}

export function invitationExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export type InvitationSnapshot = {
  readonly email: string;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly revokedAt: Date | null;
};

export type InvitationState = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";

export const INVITATION_STATE_LABELS: Record<InvitationState, string> = {
  PENDING: "未参加",
  ACCEPTED: "参加済み",
  REVOKED: "取り消し済み",
  EXPIRED: "期限切れ",
};

/**
 * 招待がいまどの状態か。
 *
 * 取り消しを期限切れより先に見る。取り消したものが期限を過ぎたとき「期限切れ」と出ると、
 * 取り消した側からは効いたのかどうかが読めない。
 */
export function invitationState(
  invitation: InvitationSnapshot,
  now: Date = new Date(),
): InvitationState {
  if (invitation.acceptedAt) return "ACCEPTED";
  if (invitation.revokedAt) return "REVOKED";
  if (invitation.expiresAt.getTime() <= now.getTime()) return "EXPIRED";
  return "PENDING";
}

export type InvitationCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: InvitationRejectionReason; readonly message: string };

export type InvitationRejectionReason =
  | "ACCEPTED"
  | "REVOKED"
  | "EXPIRED"
  | "EMAIL_MISMATCH"
  | "ALREADY_MEMBER";

/**
 * この招待を、いまログインしている人が受け入れてよいか。
 *
 * リンクを知っていれば誰でも開けるため、**宛先のメールアドレスと一致するかをここで見る**。
 * 一致しない場合に「無効なリンク」とだけ返さないのは、宛先を取り違えたのか期限切れなのかで
 * 次にやることが違うため（受け入れ側の画面が理由ごとの案内を出す）。
 */
export function checkInvitationAcceptable(
  invitation: InvitationSnapshot,
  viewerEmail: string | null | undefined,
  isAlreadyMember: boolean,
  now: Date = new Date(),
): InvitationCheck {
  const state = invitationState(invitation, now);

  if (state === "ACCEPTED") {
    return { ok: false, reason: "ACCEPTED", message: "この招待はすでに使われています。" };
  }
  if (state === "REVOKED") {
    return {
      ok: false,
      reason: "REVOKED",
      message: "この招待は取り消されています。招待した人に発行し直してもらってください。",
    };
  }
  if (state === "EXPIRED") {
    return {
      ok: false,
      reason: "EXPIRED",
      message: "この招待は期限が切れています。招待した人に発行し直してもらってください。",
    };
  }

  if (isAlreadyMember) {
    return {
      ok: false,
      reason: "ALREADY_MEMBER",
      message: "すでにこの家庭のメンバーです。",
    };
  }

  const viewer = normalizeEmailForCompare(viewerEmail);
  if (viewer !== invitation.email) {
    return {
      ok: false,
      reason: "EMAIL_MISMATCH",
      message: `この招待の宛先は ${invitation.email} です。宛先のアカウントでログインし直すか、招待した人に発行し直してもらってください。`,
    };
  }

  return { ok: true };
}
