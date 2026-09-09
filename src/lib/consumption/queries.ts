/**
 * 写真からの減算候補の読み取り（#11）。
 *
 * `src/lib/inventory/queries.ts`と同じ約束で、どの関数も先頭で`scopeToHousehold()`を通し、
 * そこで返った`householdId`だけをwhereに使う。
 */
import { db } from "@/lib/db";
import { scopeToHousehold } from "@/lib/household/access";
import { householdMembershipStore } from "@/lib/household/store";
import {
  INTAKE_CREDENTIAL_ENV_KEYS,
  MAX_IMAGES_PER_BATCH,
  readIntakeConfig,
} from "@/lib/intake/config";
import { readMonthlyUsage, type MonthlyUsage } from "@/lib/intake/queries";
import { readIntakeSettings } from "@/lib/intake/settings";
import type { InventoryContext } from "@/lib/inventory/service";

async function scope(ctx: InventoryContext): Promise<string> {
  const { householdId } = await scopeToHousehold(
    householdMembershipStore,
    ctx.userId,
    ctx.householdId,
  );
  return householdId;
}

/**
 * 候補と一緒に画面へ出す、その家庭の状況。
 *
 * 資格情報も費用の上限も**写真取込（#10）と共通**なので、ここでは`src/lib/intake/`の
 * 設定をそのまま読む（上限を機能ごとに分けない）。
 */
export interface ConsumptionScanContext {
  /** 読み取りを実行できるか。設定が無ければ画面は開くが、送信だけができない。 */
  readonly configured: boolean;
  /** 未設定の環境変数名。値そのものは出さない。 */
  readonly missingKeys: readonly string[];
  /** 今月の使用量と、設定されている上限（0は「上限なし」）。 */
  readonly usage: MonthlyUsage;
  readonly monthlyRequestLimit: number;
  readonly monthlyCostLimitYen: number;
  readonly stopOnLimit: boolean;
  readonly maxImages: number;
}

export async function getConsumptionScanContext(
  ctx: InventoryContext,
): Promise<ConsumptionScanContext> {
  const householdId = await scope(ctx);
  const config = readIntakeConfig();
  const [settings, usage] = await Promise.all([
    readIntakeSettings(householdId),
    readMonthlyUsage(householdId),
  ]);

  return {
    configured: config !== null,
    // どちらか1つあればよいので、両方欠けているときだけ「未設定」として並べる。
    missingKeys: config === null ? [...INTAKE_CREDENTIAL_ENV_KEYS] : [],
    usage,
    monthlyRequestLimit: settings.monthlyRequestLimit,
    monthlyCostLimitYen: settings.monthlyCostLimitYen,
    stopOnLimit: settings.stopOnLimit,
    maxImages: MAX_IMAGES_PER_BATCH,
  };
}

const SCAN_ITEM_SELECT = {
  id: true,
  detectedLabel: true,
  detectedBarcode: true,
  proposedAmount: true,
  confirmedAmount: true,
  unit: true,
  aiConfidence: true,
  confidence: true,
  skipReason: true,
  evidence: true,
  status: true,
  transactionId: true,
  sortOrder: true,
  product: { select: { id: true, name: true, brand: true } },
  stockLot: {
    select: {
      id: true,
      quantity: true,
      unit: true,
      bestBeforeDate: true,
      useByDate: true,
      noExpiry: true,
      openedAt: true,
      storageLocation: { select: { name: true } },
      storagePosition: { select: { name: true } },
    },
  },
} as const;

export type ConsumptionScanView = NonNullable<Awaited<ReturnType<typeof getConsumptionScan>>>;
export type ConsumptionScanItemView = ConsumptionScanView["items"][number];

/** 解析1回ぶんと、その候補。 */
export async function getConsumptionScan(ctx: InventoryContext, scanId: string) {
  const householdId = await scope(ctx);

  return db.consumptionScan.findFirst({
    where: { id: scanId, householdId },
    select: {
      id: true,
      kind: true,
      status: true,
      imageCount: true,
      model: true,
      ruleVersion: true,
      error: true,
      createdAt: true,
      items: { orderBy: { sortOrder: "asc" }, select: SCAN_ITEM_SELECT },
    },
  });
}

/**
 * いちばん新しい解析。
 *
 * 画面を開き直したときに、直前に出した候補がそのまま残るようにする
 * （撮り直しからやり直させると、確定していない候補が黙って消える）。
 */
export async function getLatestConsumptionScan(ctx: InventoryContext) {
  const householdId = await scope(ctx);

  return db.consumptionScan.findFirst({
    where: { householdId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      kind: true,
      status: true,
      imageCount: true,
      model: true,
      ruleVersion: true,
      error: true,
      createdAt: true,
      items: { orderBy: { sortOrder: "asc" }, select: SCAN_ITEM_SELECT },
    },
  });
}

/** `evidence`はJSONで持っているため、画面に出す前に文字列の配列へ正す。 */
export function evidenceLines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((line): line is string => typeof line === "string").slice(0, 8);
}
