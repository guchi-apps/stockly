"use server";

/**
 * 家庭とメンバーの画面から呼ぶServer Action（#12）。
 *
 * 在庫側の`(app)/actions.ts`と同じで、ここは「フォームの値を読む → `service.ts`を呼ぶ →
 * 画面へ戻す」だけを担う。**役割の判定（オーナーだけができる操作）は`service.ts`が行う。**
 * 画面がボタンを出さないことは担保にならない——フォームは誰でも直接送れるため。
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { resolveActiveHouseholdId } from "@/lib/household/access";
import {
  clearActiveHouseholdCookie,
  setActiveHouseholdCookie,
} from "@/lib/household/active-household";
import {
  HOUSEHOLD_ROLE_LABELS,
  parseHouseholdRole,
} from "@/lib/household/members";
import {
  changeMemberRole,
  createInvitation,
  leaveHousehold,
  removeMember,
  renameHousehold,
  revokeInvitation,
} from "@/lib/household/service";
import { getCurrentSession } from "@/lib/auth/current-user";
import { requireInventoryContextForAction } from "@/lib/inventory/context";

import { rawInput, str, userFacingMessage, withParams } from "../action-result";
import type { InviteFormState } from "./form-state";

const HOUSEHOLD_PATH = "/household";

/** 家庭の名前・メンバーは外枠（家庭名）と`/menu`にも出るため、まとめて作り直す。 */
function revalidateHousehold(): void {
  revalidatePath("/household");
  revalidatePath("/menu");
  revalidatePath("/inventory");
}

/**
 * 見る家庭を切り替える。
 *
 * 送られてきたidをそのままCookieへ入れず、**所属している家庭かを確かめてから**入れる
 * （`resolveActiveHouseholdId()`）。所属していない値は既定の家庭へ落ちるだけで、
 * 在庫のクエリは`scopeToHousehold()`が改めて所属を確かめるため越境にはならない。
 */
export async function switchHouseholdAction(formData: FormData): Promise<void> {
  const session = await getCurrentSession();
  if (!session) redirect("/login");

  const requested = str(formData, "householdId");
  const next = resolveActiveHouseholdId(session.householdIds, requested);
  if (!next || next !== requested) {
    redirect(withParams(HOUSEHOLD_PATH, { error: "その家庭には所属していません。" }));
  }

  await setActiveHouseholdCookie(next);
  revalidateHousehold();
  redirect(withParams(HOUSEHOLD_PATH, { notice: "見る家庭を切り替えました。" }));
}

export async function renameHouseholdAction(formData: FormData): Promise<void> {
  const ctx = await requireInventoryContextForAction();
  let outcome: { notice?: string; error?: string };

  try {
    const name = await renameHousehold(ctx, str(formData, "name"));
    outcome = { notice: `家庭の名前を「${name}」にしました。` };
  } catch (error) {
    outcome = { error: userFacingMessage(error) };
  }

  revalidateHousehold();
  redirect(withParams(HOUSEHOLD_PATH, outcome));
}

/**
 * 招待リンクを発行する。
 *
 * 結果を`useActionState`で返すのは、**平文のトークンをURLへ載せないため**。
 * リダイレクトのクエリに入れると、ブラウザの履歴とサーバーのアクセスログにリンクが残る。
 */
export async function inviteMemberAction(
  _prevState: InviteFormState,
  formData: FormData,
): Promise<InviteFormState> {
  const ctx = await requireInventoryContextForAction();
  const input = rawInput(formData);

  try {
    const role = parseHouseholdRole(input.role);
    const invitation = await createInvitation(ctx, { email: input.email ?? "", role });

    revalidateHousehold();
    return {
      errors: {},
      values: {},
      issued: {
        email: invitation.email,
        path: `/invitations/${invitation.token}`,
        expiresAt: invitation.expiresAt.toISOString(),
        roleLabel: HOUSEHOLD_ROLE_LABELS[invitation.role],
      },
    };
  } catch (error) {
    return { errors: { form: userFacingMessage(error) }, values: input };
  }
}

export async function revokeInvitationAction(formData: FormData): Promise<void> {
  const ctx = await requireInventoryContextForAction();
  let outcome: { notice?: string; error?: string };

  try {
    const { email } = await revokeInvitation(ctx, {
      invitationId: str(formData, "invitationId"),
    });
    outcome = { notice: `${email} への招待を取り消しました。リンクはもう使えません。` };
  } catch (error) {
    outcome = { error: userFacingMessage(error) };
  }

  revalidateHousehold();
  redirect(withParams(HOUSEHOLD_PATH, outcome));
}

export async function changeMemberRoleAction(formData: FormData): Promise<void> {
  const ctx = await requireInventoryContextForAction();
  let outcome: { notice?: string; error?: string };

  try {
    const result = await changeMemberRole(ctx, {
      targetUserId: str(formData, "targetUserId"),
      role: parseHouseholdRole(str(formData, "role")),
    });
    outcome = {
      notice: `${result.targetName} を${HOUSEHOLD_ROLE_LABELS[result.role]}にしました。`,
    };
  } catch (error) {
    outcome = { error: userFacingMessage(error) };
  }

  revalidateHousehold();
  redirect(withParams(HOUSEHOLD_PATH, outcome));
}

export async function removeMemberAction(formData: FormData): Promise<void> {
  const ctx = await requireInventoryContextForAction();
  let outcome: { notice?: string; error?: string };

  try {
    const { targetName } = await removeMember(ctx, {
      targetUserId: str(formData, "targetUserId"),
    });
    outcome = { notice: `${targetName} をこの家庭から外しました。` };
  } catch (error) {
    outcome = { error: userFacingMessage(error) };
  }

  revalidateHousehold();
  redirect(withParams(HOUSEHOLD_PATH, outcome));
}

/**
 * 自分がこの家庭から抜ける。
 *
 * 抜けた先は`/inventory`。別の家庭に所属していればそちらが開き、どこにも所属していなければ
 * 「家庭が未設定」の画面になる（次回ログイン時に新しい家庭が作られる）。
 */
export async function leaveHouseholdAction(): Promise<void> {
  const ctx = await requireInventoryContextForAction();
  let outcome: { notice?: string; error?: string };
  let left = false;

  try {
    const { householdName } = await leaveHousehold(ctx);
    outcome = { notice: `「${householdName}」から抜けました。` };
    left = true;
    // 抜けた家庭を指したままにしない（次のリクエストで既定の家庭へ落ちる）。
    await clearActiveHouseholdCookie();
  } catch (error) {
    outcome = { error: userFacingMessage(error) };
  }

  revalidateHousehold();
  // 抜けたあとは`/household`を開けない（もう所属していない）ので在庫へ戻す。
  redirect(withParams(left ? "/inventory" : HOUSEHOLD_PATH, outcome));
}
