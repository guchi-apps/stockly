/**
 * 防災判定の読み取り（#7）。
 *
 * 在庫側と同じく、**画面から`db.*.findMany()`を直接呼ばず必ずここを通す。**
 * 先頭で`scopeToHousehold()`を通し、そこで返った`householdId`だけをwhereに使う。
 *
 * 判定そのものは`assess.ts`の純関数が行い、ここは`StockLot`を判定へ渡せる形へ
 * 組み替えるところまでを受け持つ。家庭1つぶんの在庫はせいぜい数百件なので、1回引いて
 * メモリ上で仕分ける。
 */
import { db } from "@/lib/db";
import { scopeToHousehold } from "@/lib/household/access";
import { householdMembershipStore } from "@/lib/household/store";
import { resolveExpiry } from "@/lib/inventory/operations";
import type { InventoryContext } from "@/lib/inventory/service";
import { readExpirySettings, toExpiryPolicy } from "@/lib/inventory/settings";
import { Decimal, type Quantity, type UnitCode } from "@/lib/inventory/units";

import { assessDisasterStock, type DisasterAssessment, type DisasterLotSnapshot } from "./assess.ts";
import { categoryOfRole } from "./rules.ts";
import { readDisasterPlanSettings, type DisasterPlanSettings } from "./settings.ts";

async function scope(ctx: InventoryContext): Promise<string> {
  const { householdId } = await scopeToHousehold(
    householdMembershipStore,
    ctx.userId,
    ctx.householdId,
  );
  return householdId;
}

/**
 * 商品が持つ「1単位あたり」の値を、換算に使える形へ並べる。
 *
 * 持っていない値は並べない（＝その次元の区分では、この在庫は数えられない）。
 * `src/lib/replenishment/queries.ts`と同じ考え方で、補充と防災で挙動を変えない。
 */
export function perUnitEquivalentsOf(product: {
  contentAmount: Decimal | null;
  contentUnit: UnitCode | null;
  servingsPerUnit: Decimal | null;
  usesPerUnit: Decimal | null;
}): Quantity[] {
  const equivalents: Quantity[] = [];
  if (product.contentAmount && product.contentUnit) {
    equivalents.push({ amount: new Decimal(product.contentAmount), unit: product.contentUnit });
  }
  if (product.servingsPerUnit) {
    equivalents.push({ amount: new Decimal(product.servingsPerUnit), unit: "SERVING" });
  }
  if (product.usesPerUnit) {
    equivalents.push({ amount: new Decimal(product.usesPerUnit), unit: "USE" });
  }
  return equivalents;
}

/**
 * 防災判定の対象になる在庫を読み出す。
 *
 * 期限の状態は**家庭の期限設定を通して**出す（期限間近の日数が家庭ごとに違うため）。
 * ただし判定に効くのは「切れているか」「入っているか」だけなので、接近日数の違いで
 * 算入量が変わることはない。
 */
export async function loadDisasterLots(
  householdId: string,
  now: Date = new Date(),
): Promise<DisasterLotSnapshot[]> {
  const [expirySettings, lots] = await Promise.all([
    readExpirySettings(householdId),
    db.stockLot.findMany({
      where: { householdId, status: "ACTIVE" },
      select: {
        id: true,
        quantity: true,
        unit: true,
        bestBeforeDate: true,
        useByDate: true,
        noExpiry: true,
        openedAt: true,
        storageLocation: { select: { temperatureZone: true } },
        product: {
          select: {
            name: true,
            emergencyRole: true,
            temperatureZone: true,
            requiresHeating: true,
            requiresWater: true,
            contentAmount: true,
            contentUnit: true,
            servingsPerUnit: true,
            usesPerUnit: true,
          },
        },
      },
    }),
  ]);

  const policy = toExpiryPolicy(expirySettings);

  return (
    lots
      // 防災の区分に当たらない役割の在庫は、判定へ渡す前に落とす（無駄に運ばない）。
      .filter((lot) => categoryOfRole(lot.product.emergencyRole) !== null)
      .map((lot) => ({
        lotId: lot.id,
        productName: lot.product.name,
        amount: new Decimal(lot.quantity),
        unit: lot.unit,
        role: lot.product.emergencyRole,
        productZone: lot.product.temperatureZone,
        storageZone: lot.storageLocation?.temperatureZone ?? null,
        requiresHeating: lot.product.requiresHeating,
        requiresWater: lot.product.requiresWater,
        opened: lot.openedAt !== null,
        expiry: resolveExpiry(lot, now, policy),
        perUnitEquivalents: perUnitEquivalentsOf(lot.product),
      }))
  );
}

export interface DisasterOverview {
  readonly settings: DisasterPlanSettings;
  readonly assessment: DisasterAssessment;
  /** 判定した時点（画面に出して「いつ時点の数字か」を明示する）。 */
  readonly assessedAt: Date;
}

/** 防災の画面が一度に必要とするもの。 */
export async function getDisasterOverview(
  ctx: InventoryContext,
  now: Date = new Date(),
): Promise<DisasterOverview> {
  const householdId = await scope(ctx);
  const [settings, lots] = await Promise.all([
    readDisasterPlanSettings(householdId),
    loadDisasterLots(householdId, now),
  ]);

  return {
    settings,
    assessment: assessDisasterStock(lots, settings.plan),
    assessedAt: now,
  };
}
