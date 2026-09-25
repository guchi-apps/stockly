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
 *
 * **AIの設定・資格情報・費用の上限は`src/lib/intake/`（#10）と共通のものを使う。**
 * 上限を機能ごとに分けると、片方だけ設定して安心する形になるため。
 */
import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { scopeToHousehold } from "@/lib/household/access";
import { householdMembershipStore } from "@/lib/household/store";
import { readIntakeConfig } from "@/lib/intake/config";
import { readMonthlyUsage } from "@/lib/intake/queries";
import { isRetryableScan, releasedKey } from "@/lib/intake/retry";
import { readIntakeSettings, resolveModel, type IntakeSettings } from "@/lib/intake/settings";
import { InventoryInputError } from "@/lib/inventory/operations";
import {
  InventoryConflictError,
  InventoryNotFoundError,
  recordTransaction,
  type InventoryContext,
  type RecordStatus,
} from "@/lib/inventory/service";
import { Decimal } from "@/lib/inventory/units";

import {
  ObservationRequestError,
  ObservationResponseError,
  requestObservations,
  type ObservationUsage,
} from "./client.ts";
import { fingerprintImages, prepareImages } from "./images.ts";
import { isConsumptionScanKind, type ConsumptionScanKind } from "./kinds.ts";
import {
  CONSUMPTION_RULE_VERSION,
  buildConsumptionCandidates,
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
  /** 解析そのものが失敗したか。失敗の理由は`ConsumptionScan.error`にも残してある。 */
  readonly failed: boolean;
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

  const config = readIntakeConfig();
  if (!config) {
    throw new InventoryInputError(
      "form",
      "写真の読み取りはまだ設定されていません。在庫から選んで手で減らしてください。",
    );
  }

  const images = prepareImages(params.images);

  // 同じ写真の送り直しは、モデルを呼ばずに前回の結果を返す（費用も候補も二重にしない）。
  const fingerprint = fingerprintImages(images, params.kind);
  // **失敗・中断した解析は重複にしない**（#105）。再利用し続けると、その写真は二度と読ませられない。
  // 古い行は残し（使用量の集計が数える）、指紋だけ手放して新しい解析を作る。
  const now = new Date();
  const existing = await db.consumptionScan.findFirst({
    where: { householdId, imageFingerprint: fingerprint },
    select: {
      id: true,
      status: true,
      error: true,
      createdAt: true,
      inputTokens: true,
      _count: { select: { items: true } },
    },
  });
  const releasing =
    existing &&
    isRetryableScan(
      {
        status: existing.status,
        createdAt: existing.createdAt,
        itemCount: existing._count.items,
        inputTokens: existing.inputTokens,
      },
      now,
    );
  if (existing && !releasing) {
    const counts = await countItems(householdId, existing.id);
    return {
      scanId: existing.id,
      reused: true,
      failed: existing.status === "FAILED",
      error: existing.error,
      ...counts,
    };
  }

  const settings = await readIntakeSettings(householdId);
  await assertWithinLimits(householdId, settings);
  const model = resolveModel(settings, config.defaultModel);

  const scanData = {
    householdId,
    kind: params.kind,
    status: "READY" as const,
    imageFingerprint: fingerprint,
    imageCount: images.length,
    model,
    ruleVersion: CONSUMPTION_RULE_VERSION,
  };
  const scan =
    existing && releasing
      ? await db.$transaction(async (tx) => {
          await tx.consumptionScan.update({
            where: { id: existing.id },
            data: { imageFingerprint: releasedKey(fingerprint, existing.id) },
          });
          return tx.consumptionScan.create({ data: scanData, select: { id: true } });
        })
      : await db.consumptionScan.create({ data: scanData, select: { id: true } });

  // --- ここから外との通信。DBのトランザクションの外で行う ---
  let observations;
  let usage: ObservationUsage;
  try {
    const outcome = await requestObservations(
      config,
      model,
      params.kind,
      images.map((image) => ({
        mimeType: image.mimeType,
        base64: Buffer.from(image.bytes).toString("base64"),
      })),
    );
    observations = outcome.observations;
    usage = outcome;
  } catch (error) {
    if (
      !(error instanceof ObservationRequestError) &&
      !(error instanceof ObservationResponseError)
    ) {
      throw error;
    }
    // **応答が届いていた失敗では、払ったぶんのトークンも記録する**（#10と同じ約束）。
    const spent = error instanceof ObservationResponseError ? error.usage : null;
    await db.consumptionScan.update({
      where: { id: scan.id },
      data: { status: "FAILED", error: error.message, ...toUsageColumns(spent) },
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

  await db.$transaction([
    db.consumptionScan.update({
      where: { id: scan.id },
      data: toUsageColumns(usage),
    }),
    db.consumptionScanItem.createMany({
      data: [
        ...candidates.map((candidate, index) => ({
          householdId,
          scanId: scan.id,
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
          scanId: scan.id,
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
    }),
  ]);

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
 * **操作IDには候補のidをそのまま使う**（#10の反映と同じ）。別の端末・タブから同時に確定しても
 * `InventoryTransaction.id`の主キーが重複するので、履歴は1件しかできない（2件目は`duplicate`）。
 * 描画ごとに操作IDを発行すると、端末ごとに別のIDになって在庫が2回減る。
 */
export async function confirmConsumptionCandidate(
  ctx: InventoryContext,
  params: { itemId: string; amount?: Decimal | null },
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
  if (item.status === "REJECTED") {
    // 他の端末で却下済み。減らすと在庫は動くのに候補は「却下」のまま残る。
    throw new InventoryNotFoundError("この候補はすでに却下されています。");
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
    operationId: item.id,
    lotId: item.stockLotId,
    type: "CONSUME",
    amount,
    unit: item.unit,
    note: `写真から確認して記録（${item.detectedLabel}）`,
  });

  // 記録のあとに他の端末で却下されていても、在庫は動いたので確定として揃える（PENDING以外でも上書き）。
  await db.consumptionScanItem.updateMany({
    where: { id: item.id, householdId, status: { not: "CONFIRMED" } },
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

function toUsageColumns(usage: ObservationUsage | null) {
  if (!usage) return {};
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    estimatedCostYen: new Prisma.Decimal(usage.estimatedCostYen),
  };
}

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
 * 月あたりの上限に達していないか。**#10の写真取込と同じ枠で数える**
 * （`readMonthlyUsage()`が`IntakeBatch`と`ConsumptionScan`を合算する）。
 *
 * 上限に達していても手入力は使えるので、ここで止めるのは写真からの読み取りだけ。
 */
async function assertWithinLimits(householdId: string, settings: IntakeSettings): Promise<void> {
  if (!settings.stopOnLimit) return;

  const usage = await readMonthlyUsage(householdId);
  if (settings.monthlyRequestLimit > 0 && usage.requestCount >= settings.monthlyRequestLimit) {
    throw new InventoryConflictError(
      `今月の読み取り回数が上限（${settings.monthlyRequestLimit}回）に達しました。` +
        "上限は写真取込の設定から変えられます。在庫から選んで手で減らすことはこのままできます。",
    );
  }
  if (settings.monthlyCostLimitYen > 0 && usage.costYen >= settings.monthlyCostLimitYen) {
    throw new InventoryConflictError(
      `今月の概算の費用が上限（${settings.monthlyCostLimitYen}円）に達しました。` +
        "上限は写真取込の設定から変えられます。在庫から選んで手で減らすことはこのままできます。",
    );
  }
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
