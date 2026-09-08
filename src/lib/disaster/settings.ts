/**
 * 家庭ごとの防災の基準（`DisasterPlanSetting`）の読み書き（#7）。
 *
 * `src/lib/inventory/settings.ts`（期限の設定）と同じ形にしてある。
 * **読み取りは行が無くても既定値で埋めて返す**ので、家庭を作るたびに設定行を用意しなくてよい。
 *
 * 家庭の境界は在庫と同じで、画面から呼ぶ関数は必ず`scopeToHousehold()`を通す。
 */
import { db } from "@/lib/db";
import { scopeToHousehold } from "@/lib/household/access";
import { householdMembershipStore } from "@/lib/household/store";
import type { InventoryContext } from "@/lib/inventory/service";
import { Decimal } from "@/lib/inventory/units";

import {
  DEFAULT_DISASTER_PLAN,
  DISASTER_RULE_VERSION,
  type DisasterPlanValue,
} from "./rules.ts";

export interface DisasterPlanSettings {
  readonly plan: DisasterPlanValue;
  /** まだ保存されていない（既定値のまま）か。画面の説明に使う。 */
  readonly isDefault: boolean;
  /**
   * 保存されている基準に付いていたルール版。未保存なら現在の版。
   * **現在の版と違えば、保存したときとは違う規則で判定している**ことを画面で知らせる。
   */
  readonly savedRuleVersion: string;
}

export const DEFAULT_DISASTER_PLAN_SETTINGS: DisasterPlanSettings = {
  plan: DEFAULT_DISASTER_PLAN,
  isDefault: true,
  savedRuleVersion: DISASTER_RULE_VERSION,
};

const PLAN_SELECT = {
  peopleCount: true,
  targetDays: true,
  waterLitersPerPersonDay: true,
  foodServingsPerPersonDay: true,
  sanitationUsesPerPersonDay: true,
  lightingUnitsPerPerson: true,
  powerUnitsPerPerson: true,
  heatSourceUsesPerDay: true,
  includeChilled: true,
  includeFrozen: true,
  includeOpened: true,
  requireHeatSourceForHeating: true,
  requireWaterForRehydration: true,
  ruleVersion: true,
} as const;

async function scope(ctx: InventoryContext): Promise<string> {
  const { householdId } = await scopeToHousehold(
    householdMembershipStore,
    ctx.userId,
    ctx.householdId,
  );
  return householdId;
}

/**
 * 家庭idだけで読む内部用。**すでに`scopeToHousehold()`を通した`householdId`にだけ使う。**
 * 画面・Server Actionからは`getDisasterPlanSettings()`を使うこと。
 */
export async function readDisasterPlanSettings(
  householdId: string,
): Promise<DisasterPlanSettings> {
  const row = await db.disasterPlanSetting.findUnique({
    where: { householdId },
    select: PLAN_SELECT,
  });
  if (!row) return DEFAULT_DISASTER_PLAN_SETTINGS;

  const { ruleVersion, ...plan } = row;
  return {
    plan: {
      ...plan,
      // PrismaのDecimalはそのままでも計算できるが、判定側が`Decimal`前提なので明示的に包む。
      waterLitersPerPersonDay: new Decimal(plan.waterLitersPerPersonDay),
      foodServingsPerPersonDay: new Decimal(plan.foodServingsPerPersonDay),
      sanitationUsesPerPersonDay: new Decimal(plan.sanitationUsesPerPersonDay),
      lightingUnitsPerPerson: new Decimal(plan.lightingUnitsPerPerson),
      powerUnitsPerPerson: new Decimal(plan.powerUnitsPerPerson),
      heatSourceUsesPerDay: new Decimal(plan.heatSourceUsesPerDay),
    },
    isDefault: false,
    savedRuleVersion: ruleVersion,
  };
}

export async function getDisasterPlanSettings(
  ctx: InventoryContext,
): Promise<DisasterPlanSettings> {
  return readDisasterPlanSettings(await scope(ctx));
}

/**
 * 基準を保存する。行が無ければ作る。
 *
 * **保存のたびに、そのときのルール版（`DISASTER_RULE_VERSION`）を一緒に書く。**
 * 判定の規則が変わったあとで開いたときに、「保存したときとは別の規則で出している」ことを
 * 画面から伝えられるようにするため。
 */
export async function saveDisasterPlanSettings(
  ctx: InventoryContext,
  value: DisasterPlanValue,
): Promise<void> {
  const householdId = await scope(ctx);
  const data = { ...value, ruleVersion: DISASTER_RULE_VERSION };

  await db.disasterPlanSetting.upsert({
    where: { householdId },
    create: { householdId, ...data },
    update: data,
  });
}
