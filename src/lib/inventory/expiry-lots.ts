/**
 * 期限を見るためのロットの読み取り。**画面と通知ジョブが共通で使う唯一の口**。
 *
 * `queries.ts`と違い、`PrismaClient`を引数で受け取り`@/`エイリアスを使わない。cronから動く
 * `pnpm job:expiry`は`node`が直接読むため、Next.jsのパス解決に依存できないため
 * （`prisma/seed.ts`・`db-tests/helpers.ts`と同じ制約）。
 *
 * **家庭の境界**: 引数の`householdId`をそのままwhereに入れるだけで、所属の確認はしない。
 * 画面から来る経路は`queries.ts`が先に`scopeToHousehold()`を通し、通知ジョブは家庭を1件ずつ
 * 取り出してその家庭のidだけを渡す。**この関数へ利用者由来のidを直接渡さないこと。**
 */
import type { PrismaClient } from "@prisma/client";

/** 一覧・期限画面・通知が使う列。増やすときは表示側の型もあわせて変わる。 */
export const EXPIRY_LOT_SELECT = {
  id: true,
  quantity: true,
  unit: true,
  status: true,
  bestBeforeDate: true,
  useByDate: true,
  noExpiry: true,
  openedAt: true,
  note: true,
  updatedAt: true,
  product: { select: { id: true, name: true, brand: true, category: { select: { name: true } } } },
  storageLocation: { select: { id: true, name: true } },
  storagePosition: { select: { id: true, name: true } },
} as const;

export type ExpiryLot = Awaited<ReturnType<typeof findActiveLotsForExpiry>>[number];

/**
 * その家庭の、いま持っている在庫（ACTIVE）。
 *
 * `onlyWithExpiryDate`を立てると期限の日付があるものだけに絞る（通知は日付のある在庫だけを
 * 対象にするため）。期限の状態そのものはSQLではなく`resolveExpiry()`で判定する
 * ——しきい値が家庭ごとで、日付の境目も日本時間で数える必要があるため。
 */
export async function findActiveLotsForExpiry(
  db: PrismaClient,
  householdId: string,
  options: { onlyWithExpiryDate?: boolean } = {},
) {
  return db.stockLot.findMany({
    where: {
      householdId,
      status: "ACTIVE",
      ...(options.onlyWithExpiryDate
        ? {
            quantity: { gt: 0 },
            OR: [{ bestBeforeDate: { not: null } }, { useByDate: { not: null } }],
          }
        : {}),
    },
    select: EXPIRY_LOT_SELECT,
  });
}
