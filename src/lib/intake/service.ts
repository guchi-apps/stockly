/**
 * 写真取込の書き込み（#10）。
 *
 * この層の約束は4つ。
 *
 * 1. **在庫はここでは動かさない。** 反映は`src/lib/inventory/service.ts`の`createStockLot()`を
 *    呼ぶだけで、写真専用の在庫の作り方は持たない
 * 2. **モデルの出力をそのままDBへ入れない。** 必ず`extraction.ts`の`parseExtraction()`を通す
 * 3. **AIは既知の値を上書きしない。** 欄ごとの優先順位づけは`buildStockLotCandidate()`
 *    （確定済みルール > バーコード > AI候補）に任せ、ここで別の規則を足さない
 * 4. **外との通信をDBのトランザクションの中で行わない。** 画像を保存してから外で読み取り、
 *    結果だけを書き戻す（Notion連携と同じ形）
 */
import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";

import { buildStockLotCandidate, type StockLotCandidate } from "@/lib/barcode/candidate";
import { db } from "@/lib/db";
import { scopeToHousehold } from "@/lib/household/access";
import { householdMembershipStore } from "@/lib/household/store";

import {
  InventoryInputError,
  type ExpiryKind,
  type StockLotFormValue,
} from "../inventory/operations.ts";
import {
  InventoryConflictError,
  InventoryNotFoundError,
  createStockLot,
  type InventoryContext,
} from "../inventory/service.ts";
import { Decimal, type UnitCode } from "../inventory/units.ts";

import { initialCandidateStatus, isApplicable } from "./candidates.ts";
import { requestExtraction, IntakeRequestError, IntakeResponseError } from "./client.ts";
import {
  MAX_IMAGES_PER_BATCH,
  MAX_IMAGE_BYTES,
  readIntakeConfig,
  type AllowedImageMimeType,
} from "./config.ts";
import { INTAKE_PROMPT_VERSION, type ExtractedItem } from "./extraction.ts";
import type { IntakeImageKind } from "./prompt.ts";
import { findBatchIdByImageHash, readMonthlyUsage } from "./queries.ts";
import { readIntakeSettings, resolveModel, type IntakeSettings } from "./settings.ts";

const DAY_MS = 86_400_000;

async function scope(ctx: InventoryContext): Promise<string> {
  const { householdId } = await scopeToHousehold(
    householdMembershipStore,
    ctx.userId,
    ctx.householdId,
  );
  return householdId;
}

async function findMemberId(householdId: string, userId: string): Promise<string | null> {
  const member = await db.householdMember.findFirst({
    where: { householdId, userId },
    select: { id: true },
  });
  return member?.id ?? null;
}

export interface UploadedImage {
  readonly kind: IntakeImageKind;
  readonly mimeType: AllowedImageMimeType;
  readonly bytes: Uint8Array;
}

export type CreateIntakeResult =
  /** 新しく取り込んだ。 */
  | { readonly status: "created"; readonly batchId: string }
  /** 同じ画像がすでに取り込まれていた。新しい取り込みは作っていない。 */
  | { readonly status: "duplicate"; readonly batchId: string }
  /** 送ったが読み取れなかった。取り込みの記録は残るので、手入力へ戻す案内を出す。 */
  | { readonly status: "failed"; readonly batchId: string; readonly message: string };

/**
 * 写真を取り込んで候補を作る。
 *
 * **同じ画像を送り直しても新しい取り込みを作らない**（受入条件の二重登録の防止）。
 * 画像のSHA-256が家庭内で一致したら、その画像が属する取り込みへ案内する。
 */
export async function createIntakeBatch(
  ctx: InventoryContext,
  params: { images: readonly UploadedImage[] },
  now: Date = new Date(),
): Promise<CreateIntakeResult> {
  const householdId = await scope(ctx);
  const config = readIntakeConfig();
  if (!config) {
    throw new InventoryConflictError(
      "AIの資格情報が設定されていないため、写真からの読み取りはできません。手入力で登録してください。",
    );
  }

  const images = validateImages(params.images);
  const settings = await readIntakeSettings(householdId);
  await assertWithinLimits(householdId, settings, now);

  // 1枚でも取り込み済みの画像があれば、そこで止めて前回の取り込みへ返す。
  for (const image of images) {
    const existing = await findBatchIdByImageHash(householdId, sha256(image.bytes));
    if (existing) return { status: "duplicate", batchId: existing };
  }

  const model = resolveModel(settings, config.defaultModel);
  const memberId = await findMemberId(householdId, ctx.userId);
  const retainUntil =
    settings.imageRetentionDays > 0
      ? new Date(now.getTime() + settings.imageRetentionDays * DAY_MS)
      : null;

  // **画像は入れ子のcreateで作れない。** `IntakeImage`の`householdId`は
  // 「家庭への参照」と「取り込みへの複合外部キー」の両方に使われているため、Prismaが
  // 入れ子の中では自分で決める列とみなす（`Unknown argument householdId`で落ちる）。
  // 取り込みと画像を1つのトランザクションで作り、画像のidを並び順で受け取る。
  const batch = await db.$transaction(async (tx) => {
    const created = await tx.intakeBatch.create({
      data: {
        householdId,
        memberId,
        status: "EXTRACTING",
        model,
        promptVersion: INTAKE_PROMPT_VERSION,
      },
      select: { id: true },
    });

    const rows: { id: string }[] = [];
    for (const [index, image] of images.entries()) {
      rows.push(
        await tx.intakeImage.create({
          data: {
            householdId,
            batchId: created.id,
            kind: image.kind,
            sha256: sha256(image.bytes),
            mimeType: image.mimeType,
            byteSize: image.bytes.byteLength,
            data: Buffer.from(image.bytes),
            retainUntil,
            sortOrder: index,
          },
          select: { id: true },
        }),
      );
    }

    return { id: created.id, images: rows };
  });

  // --- ここから外との通信。DBのトランザクションの外で行う ---
  const [storageNames, productNames] = await Promise.all([
    listStorageNames(householdId),
    settings.sendProductNames ? listProductNames(householdId) : Promise.resolve(null),
  ]);

  try {
    const outcome = await requestExtraction(config, model, {
      images: images.map((image) => ({
        kind: image.kind,
        mimeType: image.mimeType,
        base64: Buffer.from(image.bytes).toString("base64"),
      })),
      storageNames,
      productNames,
    });

    await saveCandidates(householdId, batch.id, batch.images, outcome.items, now);

    await db.intakeBatch.update({
      where: { id: batch.id },
      data: {
        status: "REVIEWING",
        inputTokens: outcome.inputTokens,
        outputTokens: outcome.outputTokens,
        estimatedCostYen: new Prisma.Decimal(outcome.estimatedCostYen),
        completedAt: now,
      },
    });
  } catch (error) {
    const message = errorMessage(error);
    // **応答が届いていた失敗では、払ったぶんのトークンも記録する。** 0にすると、
    // 読めない応答が続くあいだ費用の上限が効かないまま送り続けることになる。
    const usage = error instanceof IntakeResponseError ? error.usage : null;
    await db.intakeBatch.update({
      where: { id: batch.id },
      data: {
        status: "FAILED",
        error: message,
        completedAt: now,
        ...(usage
          ? {
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              estimatedCostYen: new Prisma.Decimal(usage.estimatedCostYen),
            }
          : {}),
      },
    });
    // **画像の記録は残す。** 消すと、同じ写真を送り直すたびに同じ失敗を繰り返すことになる。
    await purgeIfNotRetained(householdId, batch.id, settings, now);
    return { status: "failed", batchId: batch.id, message };
  }

  await purgeIfNotRetained(householdId, batch.id, settings, now);
  return { status: "created", batchId: batch.id };
}

/** 送る前に弾く入力。枚数・大きさ・形式はここだけで見る。 */
function validateImages(images: readonly UploadedImage[]): readonly UploadedImage[] {
  if (images.length === 0) {
    throw new InventoryInputError("images", "写真を1枚以上選んでください。");
  }
  if (images.length > MAX_IMAGES_PER_BATCH) {
    throw new InventoryInputError(
      "images",
      `写真は1回に${MAX_IMAGES_PER_BATCH}枚までです。分けて取り込んでください。`,
    );
  }
  for (const image of images) {
    if (image.bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new InventoryInputError("images", "1枚あたり10MBまでです。");
    }
    if (image.bytes.byteLength === 0) {
      throw new InventoryInputError("images", "読み取れない画像が含まれています。");
    }
  }
  return images;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * 費用の上限に達していないか。**上限に達していても手入力は使える**ので、ここで止めるのは
 * 抽出だけ。上限が0のときは「上限なし」として扱う。
 */
async function assertWithinLimits(
  householdId: string,
  settings: IntakeSettings,
  now: Date,
): Promise<void> {
  if (!settings.stopOnLimit) return;

  const usage = await readMonthlyUsage(householdId, now);
  if (settings.monthlyRequestLimit > 0 && usage.requestCount >= settings.monthlyRequestLimit) {
    throw new InventoryConflictError(
      `今月の読み取り回数が上限（${settings.monthlyRequestLimit}回）に達しました。` +
        "上限は設定から変えられます。手入力での登録はこのまま使えます。",
    );
  }
  if (settings.monthlyCostLimitYen > 0 && usage.costYen >= settings.monthlyCostLimitYen) {
    throw new InventoryConflictError(
      `今月の概算の費用が上限（${settings.monthlyCostLimitYen}円）に達しました。` +
        "上限は設定から変えられます。手入力での登録はこのまま使えます。",
    );
  }
}

async function listStorageNames(householdId: string): Promise<string[]> {
  const rows = await db.storageLocation.findMany({
    where: { householdId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { name: true },
  });
  return rows.map((row) => row.name);
}

async function listProductNames(householdId: string): Promise<string[]> {
  const rows = await db.product.findMany({
    where: { householdId },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: { name: true },
  });
  return rows.map((row) => row.name);
}

/** 「保存しない」設定なら、抽出が済んだ時点で画像の中身を消す。 */
async function purgeIfNotRetained(
  householdId: string,
  batchId: string,
  settings: IntakeSettings,
  now: Date,
): Promise<void> {
  if (settings.imageRetentionDays > 0) return;
  await db.intakeImage.updateMany({
    where: { householdId, batchId },
    data: { data: null, purgedAt: now, retainUntil: null },
  });
}

/**
 * 保存期間を過ぎた画像の中身を消す。**`sha256`は消さない**——消すと、その瞬間から
 * 同じ写真の二重登録を止められなくなる。
 *
 * cronは置かず、写真取込の画面を開いたときに呼ぶ。1家庭あたりの枚数はたかが知れており、
 * 「掃除のためだけに常駐を1つ増やす」ほうが割に合わない。
 */
export async function purgeExpiredIntakeImages(
  ctx: InventoryContext,
  now: Date = new Date(),
): Promise<number> {
  const householdId = await scope(ctx);
  const result = await db.intakeImage.updateMany({
    where: { householdId, purgedAt: null, retainUntil: { not: null, lt: now } },
    data: { data: null, purgedAt: now },
  });
  return result.count;
}

/** 保存されている画像の中身をすべて消す（設定画面の「すべて削除する」）。 */
export async function deleteAllIntakeImages(
  ctx: InventoryContext,
  now: Date = new Date(),
): Promise<number> {
  const householdId = await scope(ctx);
  const result = await db.intakeImage.updateMany({
    where: { householdId, purgedAt: null },
    data: { data: null, purgedAt: now, retainUntil: null },
  });
  return result.count;
}

/**
 * 読み取った内容を候補として保存する。
 *
 * **欄ごとの優先順位づけは`buildStockLotCandidate()`に任せる**（#9と同じ関数）。
 * ここが決めるのは「AIの読みをどの欄へ渡すか」までで、既知の値との強弱は足さない。
 *
 * **写真から読んだ商品名が既存の商品と一致したら、その商品マスタ（`Product`）も渡す。**
 * #52でカテゴリと既定の単位の正本が`Product`へ一本化されたため、マスタから採る値が
 * 「その家庭で最後に確定した値」そのものになる。渡さないと、確定済みのカテゴリ・単位を
 * 無視してAIの読みを採ってしまう。
 */
async function saveCandidates(
  householdId: string,
  batchId: string,
  images: readonly { id: string }[],
  items: readonly ExtractedItem[],
  now: Date,
): Promise<void> {
  if (items.length === 0) return;

  // **`tokyoToday()`を通さず`now`をそのまま渡す。** `buildStockLotCandidate()`は日付をUTCの暦日
  // として扱う約束で（`candidate.ts`）、学習ルールへ日数を書く`rememberProductRule()`も同じ数え方を
  // する。片方だけ日本時間に寄せると、JSTの0時〜9時に取り込んだときだけ期限が1日先になる
  // （#9の`lookupBarcode()`も素の`new Date()`を渡している）。
  const today = now;
  const locations = await db.storageLocation.findMany({
    where: { householdId },
    select: { id: true, name: true },
  });
  const locationByName = new Map(locations.map((location) => [location.name, location.id]));

  const rows: Prisma.IntakeCandidateCreateManyInput[] = [];

  for (const item of items) {
    const memory = item.productName ? await findProductMemory(householdId, item.productName) : null;

    const candidate = buildStockLotCandidate({
      rule: memory?.rule ?? null,
      master: memory?.master ?? null,
      ai: {
        productName: item.productName,
        categoryName: item.categoryName,
        unit: item.unit,
        expiryKind: item.expiryKind,
        expiryDate: item.expiryDate,
      },
      today,
    });

    const storageLocationId =
      candidate.values.storageLocationId ??
      (item.storageName ? (locationByName.get(item.storageName) ?? null) : null);
    // 詳細位置は保管場所とセットでしか意味を持たない（ルールが場所ごと採れたときだけ残る）。
    const storagePositionId =
      candidate.values.storageLocationId === storageLocationId
        ? (candidate.values.storagePositionId ?? null)
        : null;

    rows.push({
      householdId,
      batchId,
      imageId: item.imageIndex === null ? null : (images[item.imageIndex]?.id ?? null),
      status: initialCandidateStatus(item),
      productName: candidate.values.productName ?? "",
      brand: item.brand ?? "",
      categoryName: candidate.values.categoryName ?? "",
      amount: item.amount === null ? null : new Prisma.Decimal(item.amount),
      unit: (candidate.values.unit as UnitCode | undefined) ?? "PIECE",
      storageLocationId,
      storagePositionId,
      expiryKind: (candidate.values.expiryKind as ExpiryKind | undefined) ?? "UNKNOWN",
      expiryDate: candidate.values.expiryDate ? new Date(`${candidate.values.expiryDate}T00:00:00Z`) : null,
      note: null,
      confidence: toDecimal(item.confidence),
      productNameConfidence: toDecimal(item.fieldConfidence.productName),
      amountConfidence: toDecimal(item.fieldConfidence.amount),
      expiryConfidence: toDecimal(item.fieldConfidence.expiry),
      categoryConfidence: toDecimal(item.fieldConfidence.category),
      storageConfidence: toDecimal(item.fieldConfidence.storage),
      evidence: describeEvidence(item, candidate),
      fieldSources: candidate.sources as Prisma.InputJsonValue,
    });
  }

  await db.intakeCandidate.createMany({ data: rows });
}

/**
 * 候補の根拠。写真から読んだ内容に加えて、**採らなかったAIの読みも残す。**
 *
 * 確定済みルールが勝った欄では、写真に印字されていた日付が候補に出てこない。理由を書かないと
 * 「読めなかった」のか「読めたが採らなかった」のかが区別できず、直す判断ができない。
 */
function describeEvidence(item: ExtractedItem, candidate: StockLotCandidate): string | null {
  const parts: string[] = [];
  if (item.evidence) parts.push(item.evidence);

  if (item.expiryDate && candidate.sources.expiryDate === "RULE") {
    parts.push(`写真からは${item.expiryDate}と読めましたが、前回の確定を優先しています。`);
  }
  if (candidate.confirmedCount > 0) {
    parts.push(`この商品はこれまでに${candidate.confirmedCount}回登録しています。`);
  }

  const text = parts.join(" ");
  return text === "" ? null : text.slice(0, 500);
}

function toDecimal(value: number | null): Prisma.Decimal | null {
  return value === null ? null : new Prisma.Decimal(value);
}

/**
 * 写真から読んだ商品名で、その家庭が覚えている内容を引く。見つからなければ`null`。
 *
 * **カテゴリと既定の単位は`Product`から採る**（#52で正本が一本化された）。置き場所と期限だけが
 * `ProductRule`にある。この2つを分けて返すのは、`buildStockLotCandidate()`が
 * 「マスタ（`Product`）」と「確定済みルール（`ProductRule`）」を別の段として扱うため。
 */
async function findProductMemory(householdId: string, productName: string) {
  const product = await db.product.findFirst({
    where: { householdId, name: productName },
    select: {
      name: true,
      defaultUnit: true,
      category: { select: { name: true } },
      rule: {
        select: {
          storageLocationId: true,
          storagePositionId: true,
          expiryKind: true,
          shelfLifeDays: true,
          confirmedCount: true,
        },
      },
    },
  });
  if (!product) return null;

  return {
    master: {
      productName: product.name,
      categoryName: product.category?.name ?? null,
      defaultUnit: product.defaultUnit,
    },
    rule: product.rule,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof IntakeRequestError || error instanceof IntakeResponseError) {
    return error.message;
  }
  return "読み取りに失敗しました。";
}

// ---------------------------------------------------------------------------
// 候補の確認・修正・却下・反映
// ---------------------------------------------------------------------------

/** 候補1件を人が直した内容で上書きする。**直した欄の出所は「人の入力」になるので出所を消す。** */
export async function updateIntakeCandidate(
  ctx: InventoryContext,
  params: { candidateId: string } & StockLotFormValue,
): Promise<void> {
  const householdId = await scope(ctx);
  const candidate = await requireCandidate(householdId, params.candidateId);
  if (candidate.status === "APPLIED") {
    throw new InventoryConflictError("この候補はすでに在庫へ反映しています。");
  }

  await db.intakeCandidate.update({
    where: { id: candidate.id },
    data: {
      productName: params.productName,
      brand: params.brand,
      categoryName: params.categoryName ?? "",
      amount: params.amount,
      unit: params.unit,
      storageLocationId: params.storageLocationId,
      storagePositionId: params.storagePositionId,
      expiryKind: params.expiryKind,
      expiryDate: params.expiryDate,
      opened: params.opened,
      note: params.note,
      status: "PENDING",
      fieldSources: Prisma.DbNull,
    },
  });
}

/** 却下する・却下を取り消す。反映済みの候補は変えられない（履歴から取り消す）。 */
export async function setIntakeCandidateRejected(
  ctx: InventoryContext,
  params: { candidateId: string; rejected: boolean },
): Promise<void> {
  const householdId = await scope(ctx);
  const candidate = await requireCandidate(householdId, params.candidateId);
  if (candidate.status === "APPLIED") {
    throw new InventoryConflictError(
      "この候補はすでに在庫へ反映しています。取り消すときは履歴から行ってください。",
    );
  }

  await db.intakeCandidate.update({
    where: { id: candidate.id },
    data: { status: params.rejected ? "REJECTED" : "PENDING" },
  });
}

export interface ApplyResult {
  /** 在庫へ反映した件数。 */
  readonly applied: number;
  /** すでに反映済みだった件数（二重送信）。 */
  readonly duplicated: number;
  /** 商品名・数量が埋まっていないため反映できなかった件数。 */
  readonly incomplete: number;
  /** 反映しようとして失敗した件数と、最初の理由。 */
  readonly failed: number;
  readonly firstError: string | null;
}

/**
 * 確認待ちの候補をまとめて在庫へ反映する。
 *
 * **候補の`id`をそのまま`operationId`（＝`InventoryTransaction.id`）に使う。** 2回押しても
 * 主キーの重複になるだけで数量は動かない（在庫の二重送信対策と同じ方式で、専用の列を持たない）。
 *
 * **1件の失敗で全部を止めない。** 7件のうち1件だけ保管場所が消えていた、というときに
 * 残り6件まで巻き戻すと、やり直しの手間だけが増える。
 */
export async function applyIntakeCandidates(
  ctx: InventoryContext,
  params: { batchId: string },
  now: Date = new Date(),
): Promise<ApplyResult> {
  const householdId = await scope(ctx);

  const batch = await db.intakeBatch.findFirst({
    where: { householdId, id: params.batchId },
    select: { id: true },
  });
  if (!batch) throw new InventoryNotFoundError("この取り込みは見つかりませんでした。");

  const candidates = await db.intakeCandidate.findMany({
    where: { householdId, batchId: batch.id, status: "PENDING" },
    orderBy: { createdAt: "asc" },
  });

  let applied = 0;
  let duplicated = 0;
  let incomplete = 0;
  let failed = 0;
  let firstError: string | null = null;

  for (const candidate of candidates) {
    if (!isApplicable(candidate)) {
      incomplete += 1;
      continue;
    }

    try {
      const result = await createStockLot(ctx, {
        operationId: candidate.id,
        productName: candidate.productName,
        brand: candidate.brand,
        categoryName: candidate.categoryName || null,
        amount: candidate.amount as Decimal,
        unit: candidate.unit,
        storageLocationId: candidate.storageLocationId,
        storagePositionId: candidate.storagePositionId,
        expiryKind: candidate.expiryKind as ExpiryKind,
        expiryDate: candidate.expiryDate,
        opened: candidate.opened,
        note: candidate.note,
      });

      await db.intakeCandidate.update({
        where: { id: candidate.id },
        data: { status: "APPLIED", appliedStockLotId: result.lotId, appliedAt: now },
      });

      if (result.status === "duplicate") duplicated += 1;
      else applied += 1;
    } catch (error) {
      failed += 1;
      firstError ??= error instanceof Error ? error.message : "反映に失敗しました。";
    }
  }

  await refreshBatchStatus(householdId, batch.id);

  return { applied, duplicated, incomplete, failed, firstError };
}

/** 確認待ちが1件も残っていなければ、取り込みを「反映済み」にする。 */
async function refreshBatchStatus(householdId: string, batchId: string): Promise<void> {
  const pending = await db.intakeCandidate.count({
    where: { householdId, batchId, status: "PENDING" },
  });
  await db.intakeBatch.update({
    where: { id: batchId },
    data: { status: pending === 0 ? "APPLIED" : "REVIEWING" },
  });
}

/** 取り込みを破棄する。候補は消えるが、画像の記録（ハッシュ）は残す。 */
export async function discardIntakeBatch(
  ctx: InventoryContext,
  params: { batchId: string },
  now: Date = new Date(),
): Promise<void> {
  const householdId = await scope(ctx);

  const batch = await db.intakeBatch.findFirst({
    where: { householdId, id: params.batchId },
    select: { id: true },
  });
  if (!batch) throw new InventoryNotFoundError("この取り込みは見つかりませんでした。");

  await db.$transaction(async (tx) => {
    await tx.intakeCandidate.updateMany({
      where: { householdId, batchId: batch.id, status: "PENDING" },
      data: { status: "REJECTED" },
    });
    await tx.intakeImage.updateMany({
      where: { householdId, batchId: batch.id, purgedAt: null },
      data: { data: null, purgedAt: now, retainUntil: null },
    });
    await tx.intakeBatch.update({ where: { id: batch.id }, data: { status: "DISCARDED" } });
  });
}

async function requireCandidate(householdId: string, candidateId: string) {
  const candidate = await db.intakeCandidate.findFirst({
    where: { householdId, id: candidateId },
    select: { id: true, status: true, batchId: true },
  });
  if (!candidate) throw new InventoryNotFoundError("この候補は見つかりませんでした。");
  return candidate;
}
