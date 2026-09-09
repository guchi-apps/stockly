"use server";

/**
 * 招待の受け入れ（#12）。
 *
 * `(app)`の外に置いてあるのは、受け入れる人がまだどの家庭にも所属していない場合があり、
 * 在庫の外枠（家庭名やナビ）を出せないため。認証そのものは`src/proxy.ts`が済ませており、
 * 未ログインなら`/login?next=/invitations/<token>`へ回る。
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getCurrentUserId } from "@/lib/auth/current-user";
import { setActiveHouseholdCookie } from "@/lib/household/active-household";
import { acceptInvitation } from "@/lib/household/service";

import { str, userFacingMessage, withParams } from "../(app)/action-result";

export async function acceptInvitationAction(formData: FormData): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");

  const token = str(formData, "token");
  let outcome: { notice?: string; error?: string };

  try {
    const { householdId, householdName } = await acceptInvitation({ userId, token });
    // **参加した家庭をそのまま見せる。** 既定は「いちばん古い所属」なので、これが無いと
    // 招待された人は初回ログインで作られた自分の空の家庭を見続けることになる
    // （＝招待できても在庫を共有できない。#12の計画レビューでの指摘）。
    await setActiveHouseholdCookie(householdId);
    outcome = { notice: `「${householdName}」に参加しました。` };
  } catch (error) {
    // 受け入れられない理由（期限切れ・取り消し済み・宛先違い）は招待の画面で出したいので、
    // 元のページへ戻す。トークンはURLに残っているため付け直さなくてよい。
    redirect(
      withParams(`/invitations/${encodeURIComponent(token)}`, {
        error: userFacingMessage(error),
      }),
    );
  }

  revalidatePath("/inventory");
  revalidatePath("/household");
  redirect(withParams("/inventory", outcome));
}
