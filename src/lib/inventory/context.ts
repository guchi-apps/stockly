import { redirect } from "next/navigation";

import { getCurrentSession } from "@/lib/auth/current-user";
import { db } from "@/lib/db";

import type { InventoryContext } from "./service.ts";

/**
 * 在庫の画面・Server Actionが最初に呼ぶ入口。
 *
 * ログインしていなければ`/login`へ返し、所属している家庭が無ければ`householdId`をnullで返す
 * （在庫はどこにも置けないので、画面はその旨だけを出す）。ここで得た`householdId`は
 * そのまま`service.ts`・`queries.ts`へ渡し、そこで`scopeToHousehold()`が所属を確かめ直す。
 */
export async function requireInventoryContext(): Promise<{
  ctx: InventoryContext | null;
  userName: string;
  householdName: string | null;
}> {
  const session = await getCurrentSession();
  if (!session) redirect("/login");

  const household = session.householdId
    ? await db.household.findUnique({
        where: { id: session.householdId },
        select: { name: true },
      })
    : null;

  return {
    ctx: session.householdId ? { userId: session.user.id, householdId: session.householdId } : null,
    userName: session.user.name ?? session.user.email ?? "利用者",
    householdName: household?.name ?? null,
  };
}

/** Server Actionから使う。家庭が無い状態で書き込みへ進ませない。 */
export async function requireInventoryContextForAction(): Promise<InventoryContext> {
  const { ctx } = await requireInventoryContext();
  if (!ctx) redirect("/inventory");
  return ctx;
}
