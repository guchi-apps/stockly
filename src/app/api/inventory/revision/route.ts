import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth/current-user";
import { getInventoryRevision } from "@/lib/inventory/queries";

/**
 * 在庫が動いたかどうかだけを返す（#12）。
 *
 * 画面を開いている端末が定期的に叩き、返ってきた値がサーバーが描いた版と違えば
 * 「ほかの端末で更新されました」を出す。**在庫の中身は返さない**ので、家族が何人で
 * 開いていても増える負荷は集計1本ぶんに収まる。
 *
 * 状態を変えないGETなので、CSRFの検証は要らない（状態を変える操作はServer Actionにある）。
 * 認証は`src/proxy.ts`が済ませているが、ここでも`getCurrentSession()`で確かめ直す
 * （matcherから外れた場合に素通しにしないため）。
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401, headers: NO_STORE });
  }

  // 家庭に所属していない状態では在庫そのものが無いので、比べる版も持たせない。
  if (!session.householdId) {
    return NextResponse.json({ revision: null }, { headers: NO_STORE });
  }

  const revision = await getInventoryRevision({
    userId: session.user.id,
    householdId: session.householdId,
  });

  return NextResponse.json({ revision }, { headers: NO_STORE });
}
