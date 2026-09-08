/**
 * アプリ内のお知らせ（`NotificationDelivery`）の読み取りと既読。
 *
 * 画面から呼ぶ入口はここだけで、在庫と同じく`scopeToHousehold()`を必ず通す。
 * 通知を**作る**側は`service.ts`・`expiry-job.ts`で、そちらはcronからも動くため
 * Next.jsのパスエイリアスを使わない。読み取りは画面専用なので、ここでは使ってよい。
 */
import { db } from "@/lib/db";
import { scopeToHousehold } from "@/lib/household/access";
import { householdMembershipStore } from "@/lib/household/store";
import type { InventoryContext } from "@/lib/inventory/service";

import { runExpiryNotifications } from "./expiry-job.ts";

async function scope(ctx: InventoryContext): Promise<string> {
  const { householdId } = await scopeToHousehold(
    householdMembershipStore,
    ctx.userId,
    ctx.householdId,
  );
  return householdId;
}

export type NotificationRow = Awaited<ReturnType<typeof listNotifications>>[number];

/** 通知の記録（新しい順）。送れなかったもの・重複で見送ったものも含める。 */
export async function listNotifications(ctx: InventoryContext, options: { limit?: number } = {}) {
  const householdId = await scope(ctx);

  return db.notificationDelivery.findMany({
    where: { householdId },
    orderBy: { sentAt: "desc" },
    take: options.limit ?? 20,
    select: {
      id: true,
      kind: true,
      channel: true,
      title: true,
      body: true,
      status: true,
      error: true,
      suppressedCount: true,
      lastSuppressedAt: true,
      sentAt: true,
      readAt: true,
    },
  });
}

export async function countUnreadNotifications(ctx: InventoryContext): Promise<number> {
  const householdId = await scope(ctx);
  return db.notificationDelivery.count({
    where: { householdId, channel: "IN_APP", readAt: null, status: "SENT" },
  });
}

/** まとめて既読にする。既読の時刻は家庭で1つ（誰が読んだかまでは持たない）。 */
export async function markNotificationsRead(ctx: InventoryContext): Promise<number> {
  const householdId = await scope(ctx);
  const result = await db.notificationDelivery.updateMany({
    where: { householdId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}

/**
 * その家庭だけを対象に期限の通知ジョブを走らせる（画面の「いま期限を確認する」）。
 *
 * cronから動く`pnpm job:expiry`と同じ関数を呼ぶ。画面用に別の判定を書くと、
 * 「画面では通知されるのにcronでは来ない」といった食い違いが起きる。
 */
export async function runExpiryCheckForHousehold(ctx: InventoryContext) {
  const householdId = await scope(ctx);
  return runExpiryNotifications(db, { householdIds: [householdId] });
}
