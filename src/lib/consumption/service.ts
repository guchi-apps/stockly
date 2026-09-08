/**
 * 写真からの減算候補の書き込み（#11）。
 *
 * **解析と確定を別の関数に分けてある。** `analyzeConsumptionPhotos()`は在庫を一切変えず、
 * 候補を作るだけ。在庫が動くのは`confirmConsumptionCandidate()`だけで、こちらは画面の
 * ボタンからしか呼ばれない。**AIが自動確定する経路を持たない**（受入条件）ことを、
 * 関数の分け方そのもので担保する。
 *
 * 在庫の数量を動かすのは既存の`src/lib/inventory/service.ts`の`recordTransaction()`で、
 * ここに独自の書き込みは持たない。だから確定した候補は**ふつうの消費履歴**になり、
 * 履歴画面からそのまま取り消せる（受入条件）。
 */
import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { scopeToHousehold } from "@/lib/household/access";
import { householdMembershipStore } from "@/lib/household/store";
import { InventoryInputError } from "@/lib/inventory/operations";
import {
  InventoryNotFoundError,
  recordTransaction,
  type InventoryContext,
  type RecordStatus,
} from "@/lib/inventory/service";
import { Decimal } from "@/lib/inventory/units";
import { readVisionConfig } from "@/lib/vision/config";
import { assertImageCount, fingerprintImages, prepareImage } from "@/lib/vision/image";
import { VisionRequestError, readObservations } from "@/lib/vision/client";

import { isConsumptionScanKind, type ConsumptionScanKind } from "./kinds.ts";
import {
  CONSUMPTION_RULE_VERSION,
  buildConsumptionCandidates,
  promptFor,
  type MatchableLot,
} from "./matching.ts";

async function scope(ctx: InventoryContext): Promise<string> {
  const { householdId } = await scopeToHousehold(
    householdMembershipStore,
    ctx.userId,
    ctx.householdId,
  );
  return householdId;
}

export function parseScanKind(raw: string | undefined | null): ConsumptionScanKind {
  const value = (raw ?? "").trim();
  if (isConsumptionScanKind(value)) return value;
  throw new InventoryInputError("kind", "写真の種類を選んでください。");
}

export interface AnalyzeResult {
  readonly scanId: string;
  /** 解析そのものが失敗したか。失敗の理由は`ConsumptionScan.error`に残してある。 */
  readonly failed: boolean;
  /** 失敗したときに画面へ出す理由。 */
  readonly error: string | null;
  /** 同じ写真を送り直したときは`true`。前回の候補をそのまま出す（受入条件の「画像再送」）。 */
  readonly reused: boolean;
  readonly candidateCount: number;
  readonly skippedCount: number;
}

/**
 * 写真を読み、候補を作る。**在庫は一切変えない。**
 *
 * 失敗しても`ConsumptionScan`をFAILEDで残す。「押したのに何も起きない」を作らないためで、
 * 画面はその理由を出して手入力へ戻す導線を示す。
 */
export async function analyzeConsumptionPhotos(
  ctx: InventoryContext,
  params: { kind: ConsumptionScanKind; images: readonly Uint8Array[] },
): Promise<AnalyzeResult> {
  const householdId = await scope(ctx);

  const config = readVisionConfig();
  if (!config) {
    throw new InventoryInputError(
      "form",
      "写真の解析はまだ設定されていません。在庫から選んで手で減らしてください。",
    );
  }

  assertImageCount(params.images.length, config.maxImages);
  const images = params.images.map((bytes, index) =>
    prepareImage(bytes, { maxBytes: config.maxImageBytes, index }),
  );

  // 同じ写真の送り直しは、モデルを呼ばずに前回の結果を返す（費用も候補も二重にしない）。
  const fingerprint = await fingerprintImages(images, params.kind);
  const existing = await db.consumptionScan.findFirst({
    where: { householdId, imageFingerprint: fingerprint },
    select: { id: true, _count: { select: { items: true } } },
  });
  if (existing) {
    const counts = await countItems(householdId, existing.id);
    return { scanId: existing.id, reused: true, failed: false, error: null, ...counts };
  }

  await assertUnderDailyLimit(householdId, config.dailyLimit);

  let observations;
  let model: string;
  try {
    const result = await readObservations(config, promptFor(params.kind), images);
    observations = result.observations;
    model = result.model;
  } catch (error) {
    if (!(error instanceof VisionRequestError)) throw error;
    const scan = await db.consumptionScan.create({
      data: {
        householdId,
        kind: params.kind,
        status: "FAILED",
        imageFingerprint: fingerprint,
        imageCount: images.length,
        model: config.model,
        ruleVersion: CONSUMPTION_RULE_VERSION,
        error: error.message,
      },
      select: { id: true },
    });
    return {
      scanId: scan.id,
      reused: false,
      failed: true,
      error: error.message,
      candidateCount: 0,
      skippedCount: 0,
    };
  }

  const lots = await findMatchableLots(householdId);
  const { candidates, skipped } = buildConsumptionCandidates({
    kind: params.kind,
    observations,
    lots,
  });

  const scan = await db.$transaction(async (tx) => {
    const created = await tx.consumptionScan.create({
      data: {
        householdId,
        kind: params.kind,
        status: "READY",
        imageFingerprint: fingerprint,
        imageCount: images.length,
        model,
        ruleVersion: CONSUMPTION_RULE_VERSION,
      },
      select: { id: true },
    });

    await tx.consumptionScanItem.createMany({
      data: [
        ...candidates.map((candidate, index) => ({
          householdId,
          scanId: created.id,
          productId: candidate.lot.productId,
          stockLotId: candidate.lot.id,
          detectedLabel: candidate.label.slice(0, 200),
          detectedBarcode: candidate.detectedBarcode,
          proposedAmount: candidate.amount,
          unit: candidate.unit,
          aiConfidence: new Decimal(candidate.aiConfidence),
          confidence: new Decimal(candidate.confidence),
          evidence: candidate.evidence as Prisma.InputJsonValue,
          sortOrder: index,
        })),
        ...skipped.map((row, index) => ({
          householdId,
          scanId: created.id,
          productId: row.productId,
          detectedLabel: row.label.slice(0, 200),
          detectedBarcode: row.detectedBarcode,
          aiConfidence: new Decimal(row.aiConfidence),
          confidence: new Decimal(0),
          skipReason: row.reason,
          evidence: [row.detail] as Prisma.InputJsonValue,
          sortOrder: candidates.length + index,
        })),
      ],
    });

    return created;
  });

  return {
    scanId: scan.id,
    reused: false,
    failed: false,
    error: null,
    candidateCount: candidates.length,
    skippedCount: skipped.length,
  };
}

/**
 * 候補を1件確定し、消費として記録する。
 *
 * 数量は画面から渡された値を使う（**修正できることが受入条件**）。渡されなければ提案のまま。
 * 二重送信は`recordTransaction()`と同じ操作IDの仕組みで止まり、加えて確定済みの候補は
 * ここで弾く（画面を2つ開いていても、1つの候補から履歴が2件できない）。
 */
export async function confirmConsumptionCandidate(
  ctx: InventoryContext,
  params: { itemId: string; operationId: string; amount?: Decimal | null },
): Promise<{ status: RecordStatus | "already-confirmed"; lotId: string | null }> {
  const householdId = await scope(ctx);

  const item = await db.consumptionScanItem.findFirst({
    where: { id: params.itemId, householdId },
    select: {
      id: true,
      status: true,
      stockLotId: true,
      proposedAmount: true,
      unit: true,
      skipReason: true,
      detectedLabel: true,
    },
  });
  if (!item) throw new InventoryNotFoundError("この候補は見つかりませんでした。");

  if (item.status === "CONFIRMED") {
    return { status: "already-confirmed", lotId: item.stockLotId };
  }
  if (item.skipReason !== null || item.stockLotId === null || item.unit === null) {
    // 在庫と結び付いていないものは、この画面からは減らせない（受入条件「存在しない商品を自動減算しない」）。
    throw new InventoryInputError(
      "form",
      "この行は在庫と結び付いていないため、ここからは減らせません。在庫を選んで記録してください。",
    );
  }

  const amount = params.amount ?? item.proposedAmount;
  if (!amount || !amount.greaterThan(0)) {
    throw new InventoryInputError("amount", "減らす量を入力してください。");
  }

  const result = await recordTransaction(ctx, {
    operationId: params.operationId,
    lotId: item.stockLotId,
    type: "CONSUME",
    amount,
    unit: item.unit,
    note: `写真から確認して記録（${item.detectedLabel}）`,
  });

  await db.consumptionScanItem.updateMany({
    where: { id: item.id, householdId, status: "PENDING" },
    data: {
      status: "CONFIRMED",
      transactionId: result.transactionId,
      confirmedAmount: amount,
      confirmedAt: new Date(),
    },
  });

  return { status: result.status, lotId: result.lotId };
}

/** 候補を却下する。在庫は動かない。 */
export async function rejectConsumptionCandidate(
  ctx: InventoryContext,
  params: { itemId: string },
): Promise<void> {
  const householdId = await scope(ctx);

  const updated = await db.consumptionScanItem.updateMany({
    where: { id: params.itemId, householdId, status: "PENDING" },
    data: { status: "REJECTED" },
  });
  if (updated.count === 0) {
    throw new InventoryNotFoundError("この候補は見つからないか、すでに確定・却下されています。");
  }
}

// ---------------------------------------------------------------------------
// 材料の読み込みと歯止め
// ---------------------------------------------------------------------------

/**
 * 照合に使う在庫を集める。
 *
 * 数量0のロットも含めて渡す。「商品は登録されているが在庫が0」を`NO_STOCK`として
 * 理由付きで出すために要る（候補にしないだけで、黙って落とさない）。
 */
async function findMatchableLots(householdId: string): Promise<MatchableLot[]> {
  const lots = await db.stockLot.findMany({
    where: { householdId, status: "ACTIVE" },
    select: {
      id: true,
      quantity: true,
      unit: true,
      bestBeforeDate: true,
      useByDate: true,
      openedAt: true,
      storageLocation: { select: { name: true } },
      storagePosition: { select: { name: true } },
      product: {
        select: {
          id: true,
          name: true,
          brand: true,
          contentAmount: true,
          contentUnit: true,
          aliases: { select: { alias: true } },
          barcodes: { select: { code: true } },
        },
      },
    },
  });

  return lots.map((lot) => ({
    id: lot.id,
    productId: lot.product.id,
    productName: lot.product.name,
    brand: lot.product.brand,
    aliases: lot.product.aliases.map((alias) => alias.alias),
    barcodes: lot.product.barcodes.map((barcode) => barcode.code),
    quantity: lot.quantity,
    unit: lot.unit,
    storageLocationName: lot.storageLocation?.name ?? null,
    storagePositionName: lot.storagePosition?.name ?? null,
    // 期限は「先に来るほう」を見る。ロットは片方しか持たないが、両方入っていても矛盾しない選び方にする。
    expiryOn: earlier(lot.useByDate, lot.bestBeforeDate),
    openedAt: lot.openedAt,
    contentAmount: lot.product.contentAmount,
    contentUnit: lot.product.contentUnit,
  }));
}

function earlier(a: Date | null, b: Date | null): Date | null {
  if (a === null) return b;
  if (b === null) return a;
  return a.getTime() <= b.getTime() ? a : b;
}

/**
 * 1日あたりの解析回数の上限。**費用の歯止めはここだけ。**
 *
 * 日付の境目は日本時間で数える（`src/lib/time/tokyo.ts`と同じ約束。UTCで数えると、
 * 朝9時までの解析が前日ぶんとして扱われる）。
 */
async function assertUnderDailyLimit(householdId: string, dailyLimit: number): Promise<void> {
  const used = await countScansToday(householdId);
  if (used >= dailyLimit) {
    throw new InventoryInputError(
      "form",
      `写真の解析は1日${dailyLimit}回までです（本日はすでに${used}回）。明日また試すか、在庫から選んで手で減らしてください。`,
    );
  }
}

/** 日本時間の今日、その家庭が実行した解析の回数。 */
export async function countScansToday(householdId: string, now: Date = new Date()): Promise<number> {
  return db.consumptionScan.count({
    where: { householdId, createdAt: { gte: startOfTokyoDay(now) } },
  });
}

/** 日本時間の0時をUTCの時刻として返す。 */
function startOfTokyoDay(now: Date): Date {
  const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const shifted = new Date(now.getTime() + JST_OFFSET_MS);
  const midnight = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  );
  return new Date(midnight - JST_OFFSET_MS);
}

async function countItems(
  householdId: string,
  scanId: string,
): Promise<{ candidateCount: number; skippedCount: number }> {
  const [candidateCount, skippedCount] = await Promise.all([
    db.consumptionScanItem.count({ where: { householdId, scanId, skipReason: null } }),
    db.consumptionScanItem.count({ where: { householdId, scanId, NOT: { skipReason: null } } }),
  ]);
  return { candidateCount, skippedCount };
}
