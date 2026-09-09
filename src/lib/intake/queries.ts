/**
 * 写真取込の読み取り（#10）。
 *
 * **画面から`db.intakeBatch.findMany()`等を直接呼ばず、必ずここを通す。** どの関数も先頭で
 * `scopeToHousehold()`を通し、そこで返った`householdId`だけをwhereに使う。
 *
 * **画像の中身（`data`）は既定で読まない。** 一覧のたびに数MBを取り出すことになるため、
 * `getIntakeImageData()`だけが読む。
 */
import { db } from "@/lib/db";
import { scopeToHousehold } from "@/lib/household/access";
import { householdMembershipStore } from "@/lib/household/store";

import type { InventoryContext } from "../inventory/service.ts";
import { tokyoMonthRange } from "../time/tokyo.ts";

import { readIntakeSettings, type IntakeSettings } from "./settings.ts";

async function scope(ctx: InventoryContext): Promise<string> {
  const { householdId } = await scopeToHousehold(
    householdMembershipStore,
    ctx.userId,
    ctx.householdId,
  );
  return householdId;
}

/** 一覧に出す画像の項目。`data`を含めない。 */
const IMAGE_SELECT = {
  id: true,
  kind: true,
  sha256: true,
  mimeType: true,
  byteSize: true,
  width: true,
  height: true,
  retainUntil: true,
  purgedAt: true,
  sortOrder: true,
  createdAt: true,
} as const;

const CANDIDATE_SELECT = {
  id: true,
  status: true,
  imageId: true,
  productName: true,
  brand: true,
  categoryName: true,
  amount: true,
  unit: true,
  storageLocationId: true,
  storagePositionId: true,
  expiryKind: true,
  expiryDate: true,
  opened: true,
  note: true,
  confidence: true,
  productNameConfidence: true,
  amountConfidence: true,
  expiryConfidence: true,
  categoryConfidence: true,
  storageConfidence: true,
  evidence: true,
  fieldSources: true,
  appliedStockLotId: true,
  appliedAt: true,
  storageLocation: { select: { id: true, name: true } },
  storagePosition: { select: { id: true, name: true } },
} as const;

export type IntakeBatchRow = Awaited<ReturnType<typeof listIntakeBatches>>[number];
export type IntakeCandidateRow = NonNullable<
  Awaited<ReturnType<typeof getIntakeBatch>>
>["candidates"][number];

/** 最近の取り込み（新しい順）。 */
export async function listIntakeBatches(ctx: InventoryContext, options: { limit?: number } = {}) {
  const householdId = await scope(ctx);

  return db.intakeBatch.findMany({
    where: { householdId },
    orderBy: { createdAt: "desc" },
    take: options.limit ?? 20,
    select: {
      id: true,
      status: true,
      model: true,
      error: true,
      estimatedCostYen: true,
      createdAt: true,
      completedAt: true,
      images: { select: { id: true, kind: true, purgedAt: true }, orderBy: { sortOrder: "asc" } },
      candidates: { select: { id: true, status: true } },
    },
  });
}

/** 取り込み1件と、その候補すべて。見つからなければ`null`。 */
export async function getIntakeBatch(ctx: InventoryContext, batchId: string) {
  const householdId = await scope(ctx);

  return db.intakeBatch.findFirst({
    where: { householdId, id: batchId },
    select: {
      id: true,
      status: true,
      model: true,
      promptVersion: true,
      inputTokens: true,
      outputTokens: true,
      estimatedCostYen: true,
      error: true,
      createdAt: true,
      completedAt: true,
      images: { select: IMAGE_SELECT, orderBy: { sortOrder: "asc" } },
      candidates: { select: CANDIDATE_SELECT, orderBy: { createdAt: "asc" } },
    },
  });
}

/**
 * 画像の中身を1枚だけ読む。**サムネイルを出すときだけ呼ぶ。**
 * 保存期間を過ぎて消したあとは`data`が`null`で返る。
 */
export async function getIntakeImageData(ctx: InventoryContext, imageId: string) {
  const householdId = await scope(ctx);

  return db.intakeImage.findFirst({
    where: { householdId, id: imageId },
    select: { id: true, mimeType: true, data: true, purgedAt: true },
  });
}

/**
 * 同じ画像がすでに取り込まれていないか。**二重登録の防止はここが入口。**
 * 見つかれば、その画像が属する取り込みを返す。
 */
export async function findBatchIdByImageHash(
  householdId: string,
  sha256: string,
): Promise<string | null> {
  const row = await db.intakeImage.findUnique({
    where: { householdId_sha256: { householdId, sha256 } },
    select: { batchId: true },
  });
  return row?.batchId ?? null;
}

export interface MonthlyUsage {
  /** 今月に実行した取り込みの回数。 */
  readonly requestCount: number;
  /** 今月の概算の金額（円）。 */
  readonly costYen: number;
  /** 集計した範囲（日本時間の今月）。 */
  readonly from: Date;
  readonly to: Date;
}

/**
 * 今月の使用量。**専用のテーブルは持たず、AIへ送った記録を数えて出す**
 * （集計で出せるものを別に保存すると必ずずれる。防災の判定を保存しないのと同じ考え方）。
 *
 * 失敗した取り込みも数える。送ってしまったぶんは課金されるため。
 *
 * **写真取込（#10）と写真からの減算候補（#11）を合算する。** どちらも同じAIへ同じ資格情報で
 * 送るので、上限を機能ごとに分けると片方だけ設定して安心する形になる。
 * **AIへ写真を送る機能を足したら、ここにも足すこと**（足し忘れると、その機能だけが上限の外で動く）。
 */
export async function readMonthlyUsage(
  householdId: string,
  now: Date = new Date(),
): Promise<MonthlyUsage> {
  const { start, end } = tokyoMonthRange(now);
  const period = { householdId, createdAt: { gte: start, lt: end } };

  const [batches, scans] = await Promise.all([
    db.intakeBatch.aggregate({
      where: period,
      _count: { _all: true },
      _sum: { estimatedCostYen: true },
    }),
    db.consumptionScan.aggregate({
      where: period,
      _count: { _all: true },
      _sum: { estimatedCostYen: true },
    }),
  ]);

  return {
    requestCount: batches._count._all + scans._count._all,
    costYen:
      Number(batches._sum.estimatedCostYen ?? 0) + Number(scans._sum.estimatedCostYen ?? 0),
    from: start,
    to: end,
  };
}

export async function getMonthlyUsage(
  ctx: InventoryContext,
  now: Date = new Date(),
): Promise<MonthlyUsage> {
  return readMonthlyUsage(await scope(ctx), now);
}

export interface IntakeOverview {
  readonly settings: IntakeSettings;
  readonly usage: MonthlyUsage;
  /** いま保存されている画像の枚数と合計バイト数。設定画面の「すべて削除する」の説明に使う。 */
  readonly storedImages: { count: number; bytes: number; oldestAt: Date | null };
}

/** 取込の画面と設定の画面が共通で使う、家庭ごとの状況。 */
export async function getIntakeOverview(
  ctx: InventoryContext,
  now: Date = new Date(),
): Promise<IntakeOverview> {
  const householdId = await scope(ctx);

  const [settings, usage, stored, oldest] = await Promise.all([
    readIntakeSettings(householdId),
    readMonthlyUsage(householdId, now),
    db.intakeImage.aggregate({
      where: { householdId, purgedAt: null },
      _count: { _all: true },
      _sum: { byteSize: true },
    }),
    db.intakeImage.findFirst({
      where: { householdId, purgedAt: null },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
  ]);

  return {
    settings,
    usage,
    storedImages: {
      count: stored._count._all,
      bytes: stored._sum.byteSize ?? 0,
      oldestAt: oldest?.createdAt ?? null,
    },
  };
}
