/**
 * 家庭ごとの期限の設定（`ExpirySetting`）の読み書き。
 *
 * 行が無い家庭でも画面が成り立つよう、**読み取りは常に既定値で埋めて返す**
 * （`DEFAULT_EXPIRY_POLICY`と同じ値）。家庭を作るたびに設定行を用意する必要がない。
 *
 * 家庭の境界は在庫と同じで、画面から呼ぶ関数は必ず`scopeToHousehold()`を通す。
 */
import { db } from "@/lib/db";
import { scopeToHousehold } from "@/lib/household/access";
import { householdMembershipStore } from "@/lib/household/store";

import {
  DEFAULT_EXPIRY_POLICY,
  type ExpiryPolicy,
  type ExpirySettingsFormValue,
} from "./operations.ts";
import type { InventoryContext } from "./service.ts";

export interface ExpirySettings extends ExpirySettingsFormValue {
  /** まだ保存されていない（既定値のまま）か。画面の説明に使う。 */
  readonly isDefault: boolean;
}

export const DEFAULT_EXPIRY_SETTINGS: ExpirySettings = {
  bestBeforeSoonDays: DEFAULT_EXPIRY_POLICY.bestBeforeSoonDays,
  useBySoonDays: DEFAULT_EXPIRY_POLICY.useBySoonDays,
  highlightUnknownExpiry: true,
  notifyEnabled: true,
  isDefault: true,
};

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
 * 画面・Server Actionからは`getExpirySettings()`を使うこと。
 */
export async function readExpirySettings(householdId: string): Promise<ExpirySettings> {
  const row = await db.expirySetting.findUnique({
    where: { householdId },
    select: {
      bestBeforeSoonDays: true,
      useBySoonDays: true,
      highlightUnknownExpiry: true,
      notifyEnabled: true,
    },
  });
  if (!row) return DEFAULT_EXPIRY_SETTINGS;
  return { ...row, isDefault: false };
}

export function toExpiryPolicy(settings: ExpirySettings): ExpiryPolicy {
  return {
    bestBeforeSoonDays: settings.bestBeforeSoonDays,
    useBySoonDays: settings.useBySoonDays,
  };
}

export async function getExpirySettings(ctx: InventoryContext): Promise<ExpirySettings> {
  return readExpirySettings(await scope(ctx));
}

/** 設定を保存する。行が無ければ作る。 */
export async function saveExpirySettings(
  ctx: InventoryContext,
  value: ExpirySettingsFormValue,
): Promise<void> {
  const householdId = await scope(ctx);

  await db.expirySetting.upsert({
    where: { householdId },
    create: { householdId, ...value },
    update: { ...value },
  });
}
