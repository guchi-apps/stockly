/**
 * 在庫の書き込み。**在庫を変える処理はすべてここを通す。**
 *
 * 守っていることは3つ。
 *
 * 1. **家庭の境界。** どの関数も最初に`scopeToHousehold()`を通し、そこで返った`householdId`だけを
 *    where・dataに使う。画面から渡ってきたidは、必ずこの`householdId`との組で引く。
 * 2. **数量は履歴から動かす。** `StockLot.quantity`を単独で書き換えず、`InventoryTransaction`を
 *    1件積んだうえで、同じトランザクションの中で集計値を更新する。
 * 3. **二重送信で二重に計上しない。** 画面がフォームへ埋めた操作IDをそのまま
 *    `InventoryTransaction.id`に使う。2回目の送信は主キーの重複になるので、
 *    「すでに記録済み」として何も足さずに返す（`status: "duplicate"`）。
 */
import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { scopeToHousehold } from "@/lib/household/access";
import { householdMembershipStore } from "@/lib/household/store";

import { buildReversal, type LedgerEntry } from "./ledger.ts";
import {
  InventoryInputError,
  applyRecordToLot,
  formatQuantityWithUnit,
  nextLotStatus,
  signedDelta,
  type ExpiryKind,
  type RecordableTransactionType,
  type StockLotFormValue,
  type StorageLocationFormValue,
} from "./operations.ts";
import { Decimal, quantity, type UnitCode } from "./units.ts";

/** 誰が、どの家庭のデータを触るのか。画面は`getCurrentSession()`の値をそのまま渡す。 */
export interface InventoryContext {
  readonly userId: string;
  readonly householdId: string;
}

/** 指定された在庫・履歴・保管場所が、その家庭に無いとき。 */
export class InventoryNotFoundError extends Error {
  constructor(message = "対象が見つかりませんでした。画面を開き直してください。") {
    super(message);
    this.name = "InventoryNotFoundError";
  }
}

/** 画面を開いたあとに他の人が先に更新していたとき。 */
export class InventoryConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryConflictError";
  }
}

export type RecordStatus = "recorded" | "duplicate";

export interface RecordResult {
  readonly status: RecordStatus;
  readonly lotId: string;
  readonly transactionId: string;
}

/** 二重送信の判定に使う操作ID。フォームを描くたびに1つ発行する。 */
export function newOperationId(): string {
  return crypto.randomUUID();
}

/** 家庭を確かめ、その`householdId`を返す。書き込みの入口はすべてこれを通る。 */
async function scope(ctx: InventoryContext): Promise<string> {
  const { householdId } = await scopeToHousehold(
    householdMembershipStore,
    ctx.userId,
    ctx.householdId,
  );
  return householdId;
}

/** 記録者として履歴に残すメンバー。所属していれば必ず1件ある。 */
async function findMemberId(householdId: string, userId: string): Promise<string | null> {
  const member = await db.householdMember.findUnique({
    where: { householdId_userId: { householdId, userId } },
    select: { id: true },
  });
  return member?.id ?? null;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * ロットの行をロックする。
 *
 * 同じロットへの記録が同時に走ると、両方が同じ現在数量を読み、あとから書いたほうの集計値が
 * もう一方の増減を無かったことにする。履歴は2件残るので、集計値だけがずれる。
 * 数量を読む前にこのロックを取り、同じロットへの記録を順番に処理する。
 */
async function lockLot(
  tx: Prisma.TransactionClient,
  householdId: string,
  lotId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM StockLot WHERE id = ${lotId} AND householdId = ${householdId} FOR UPDATE`;
}

async function loadLotForUpdate(
  tx: Prisma.TransactionClient,
  householdId: string,
  lotId: string,
) {
  await lockLot(tx, householdId, lotId);
  const lot = await tx.stockLot.findFirst({
    where: { id: lotId, householdId },
    select: {
      id: true,
      productId: true,
      quantity: true,
      unit: true,
      openedAt: true,
      updatedAt: true,
      product: { select: { name: true, brand: true, categoryId: true } },
    },
  });
  if (!lot) throw new InventoryNotFoundError("この在庫は見つかりませんでした。");
  return lot;
}

// ---------------------------------------------------------------------------
// 入出庫の記録
// ---------------------------------------------------------------------------

export interface RecordTransactionParams {
  readonly operationId: string;
  readonly lotId: string;
  readonly type: RecordableTransactionType;
  readonly amount: Decimal;
  /** 省略時はロットの単位。ロットと換算できない単位は拒否する。 */
  readonly unit?: UnitCode;
  readonly note?: string | null;
  readonly occurredAt?: Date;
  /**
   * 画面が表示していた時点のロットの更新時刻。渡された場合だけ競合を検出する。
   *
   * 消費・補充のような相対的な増減は、他の人が先に記録していても意味が壊れないので渡さない。
   * 「いま4パックある」という表示を前提に絶対値を決める訂正（編集画面）でだけ渡す。
   */
  readonly expectedUpdatedAt?: Date;
}

/**
 * 購入・消費・廃棄・訂正を1件記録し、ロットの数量を更新する。
 *
 * 同じ`operationId`で2回呼ばれた場合、2回目は数量を動かさず`status: "duplicate"`を返す。
 */
export async function recordTransaction(
  ctx: InventoryContext,
  params: RecordTransactionParams,
): Promise<RecordResult> {
  const householdId = await scope(ctx);
  const memberId = await findMemberId(householdId, ctx.userId);

  try {
    return await db.$transaction(async (tx) => {
      const duplicate = await findExistingTransaction(tx, householdId, params.operationId);
      if (duplicate) return duplicate;

      const lot = await loadLotForUpdate(tx, householdId, params.lotId);
      assertNotStale(lot.updatedAt, params.expectedUpdatedAt, lot.quantity, lot.unit);

      const unit = params.unit ?? lot.unit;
      const quantityDelta = signedDelta(params.type, params.amount);
      const next = applyRecordToLot(quantity(lot.quantity, lot.unit), {
        type: params.type,
        quantityDelta,
        unit,
      });

      await tx.inventoryTransaction.create({
        data: {
          id: params.operationId,
          householdId,
          stockLotId: lot.id,
          productId: lot.productId,
          memberId,
          type: params.type,
          quantityDelta,
          unit,
          occurredAt: params.occurredAt ?? new Date(),
          note: params.note ?? null,
        },
      });

      await tx.stockLot.update({
        where: { id: lot.id },
        data: { quantity: next.amount, status: nextLotStatus(next, params.type) },
      });

      return { status: "recorded" as const, lotId: lot.id, transactionId: params.operationId };
    });
  } catch (error) {
    return (await resolveDuplicate(error, householdId, params.operationId)) ?? raise(error);
  }
}

/**
 * 履歴を1件取り消す。
 *
 * 履歴は消さず、符号を反転した`REVERSAL`行を足して数量を戻す。**直前の操作でなくても取り消せる。**
 * 二重取消はDBの`@@unique([householdId, reversesTransactionId])`が最後に弾くので、
 * 同時に押されても2回戻ることはない。
 */
export async function reverseTransaction(
  ctx: InventoryContext,
  params: { operationId: string; transactionId: string },
): Promise<RecordResult> {
  const householdId = await scope(ctx);
  const memberId = await findMemberId(householdId, ctx.userId);

  try {
    return await db.$transaction(async (tx) => {
      const duplicate = await findExistingTransaction(tx, householdId, params.operationId);
      if (duplicate) return duplicate;

      const target = await tx.inventoryTransaction.findFirst({
        where: { id: params.transactionId, householdId },
        select: {
          id: true,
          type: true,
          quantityDelta: true,
          unit: true,
          stockLotId: true,
          productId: true,
          reversesTransactionId: true,
        },
      });
      if (!target) throw new InventoryNotFoundError("この履歴は見つかりませんでした。");

      const lot = await loadLotForUpdate(tx, householdId, target.stockLotId);

      // 取消済みかどうかは、ロットをロックしたあとに数え直す（同時押しの2件目をここで止める）。
      const siblings = await tx.inventoryTransaction.findMany({
        where: { householdId, stockLotId: target.stockLotId },
        select: { id: true, type: true, quantityDelta: true, unit: true, reversesTransactionId: true },
      });

      // `buildReversal()`のメッセージはtransactionのidを含む内部向けのものなので、
      // 画面にはここで言い換えたものを出す。
      let reversal;
      try {
        reversal = buildReversal(target as LedgerEntry, siblings as LedgerEntry[]);
      } catch {
        throw new InventoryConflictError(
          target.type === "REVERSAL"
            ? "取消の記録そのものは取り消せません。"
            : "この履歴はすでに取り消されています。画面を開き直すと最新の状態が出ます。",
        );
      }

      // 取消は在庫を戻す操作なので、結果が負になっても止めない
      // （負になるのは、取消対象より後の記録が先に積まれている場合で、履歴としては正しい）。
      const next = applyRecordToLot(
        quantity(lot.quantity, lot.unit),
        { type: "REVERSAL", quantityDelta: reversal.quantityDelta, unit: reversal.unit },
        { allowNegative: true },
      );

      await tx.inventoryTransaction.create({
        data: {
          id: params.operationId,
          householdId,
          stockLotId: lot.id,
          productId: target.productId,
          memberId,
          type: "REVERSAL",
          quantityDelta: reversal.quantityDelta,
          unit: reversal.unit,
          reversesTransactionId: target.id,
          occurredAt: new Date(),
        },
      });

      await tx.stockLot.update({
        where: { id: lot.id },
        data: { quantity: next.amount, status: nextLotStatus(next, "REVERSAL") },
      });

      return { status: "recorded" as const, lotId: lot.id, transactionId: params.operationId };
    });
  } catch (error) {
    const duplicate = await resolveDuplicate(error, householdId, params.operationId);
    if (duplicate) return duplicate;
    if (isUniqueViolation(error)) {
      throw new InventoryConflictError("この履歴はすでに取り消されています。");
    }
    throw error;
  }
}

async function findExistingTransaction(
  tx: Prisma.TransactionClient,
  householdId: string,
  operationId: string,
): Promise<RecordResult | null> {
  const existing = await tx.inventoryTransaction.findFirst({
    where: { id: operationId, householdId },
    select: { id: true, stockLotId: true },
  });
  if (!existing) return null;
  return { status: "duplicate", lotId: existing.stockLotId, transactionId: existing.id };
}

/**
 * 同時の二重送信で主キーが衝突した場合の後始末。
 *
 * 先に入った1件を読み直して「記録済み」として返す。ここで例外にすると、
 * 利用者には失敗に見えるのに数量は正しく動いている、という一番分かりにくい結果になる。
 */
async function resolveDuplicate(
  error: unknown,
  householdId: string,
  operationId: string,
): Promise<RecordResult | null> {
  if (!isUniqueViolation(error)) return null;

  const existing = await db.inventoryTransaction.findFirst({
    where: { id: operationId, householdId },
    select: { id: true, stockLotId: true },
  });
  if (!existing) return null;
  return { status: "duplicate", lotId: existing.stockLotId, transactionId: existing.id };
}

function raise(error: unknown): never {
  throw error;
}

function assertNotStale(
  current: Date,
  expected: Date | undefined,
  currentQuantity: Decimal,
  unit: UnitCode,
): void {
  if (!expected) return;
  if (current.getTime() === expected.getTime()) return;

  // 「他の人が」と断定しない。同じ人が編集フォームを二重送信した場合もここへ来るため。
  throw new InventoryConflictError(
    `この在庫は、画面を開いたあとに更新されています（いまは${formatQuantityWithUnit(new Decimal(currentQuantity), unit)}）。最新の数量を確かめて、もう一度お試しください。`,
  );
}

// ---------------------------------------------------------------------------
// 在庫（ロット）の登録・編集
// ---------------------------------------------------------------------------

export interface CreateStockLotParams extends StockLotFormValue {
  readonly operationId: string;
}

/**
 * 在庫を1件登録する。商品・カテゴリが未登録なら名前で作る。
 *
 * 登録は「購入」1件として履歴に残す。数量だけが先にあって履歴が無い在庫を作らないため。
 */
export async function createStockLot(
  ctx: InventoryContext,
  params: CreateStockLotParams,
): Promise<RecordResult> {
  const householdId = await scope(ctx);
  const memberId = await findMemberId(householdId, ctx.userId);

  await assertStoragePlaceBelongs(householdId, params.storageLocationId, params.storagePositionId);
  const categoryId = await resolveCategoryId(householdId, params.categoryName);
  const productId = await resolveProductId(householdId, params.productName, params.brand, categoryId, params.unit);

  try {
    return await db.$transaction(async (tx) => {
      const duplicate = await findExistingTransaction(tx, householdId, params.operationId);
      if (duplicate) return duplicate;

      const lot = await tx.stockLot.create({
        data: {
          householdId,
          productId,
          storageLocationId: params.storageLocationId,
          storagePositionId: params.storagePositionId,
          quantity: params.amount,
          unit: params.unit,
          bestBeforeDate: params.expiryKind === "BEST_BEFORE" ? params.expiryDate : null,
          useByDate: params.expiryKind === "USE_BY" ? params.expiryDate : null,
          noExpiry: params.expiryKind === "NONE",
          openedAt: params.opened ? new Date() : null,
          note: params.note,
          status: "ACTIVE",
        },
        select: { id: true },
      });

      await tx.inventoryTransaction.create({
        data: {
          id: params.operationId,
          householdId,
          stockLotId: lot.id,
          productId,
          memberId,
          type: "PURCHASE",
          quantityDelta: params.amount,
          unit: params.unit,
          occurredAt: new Date(),
          note: params.note,
        },
      });

      return { status: "recorded" as const, lotId: lot.id, transactionId: params.operationId };
    });
  } catch (error) {
    return (await resolveDuplicate(error, householdId, params.operationId)) ?? raise(error);
  }
}

export interface UpdateStockLotParams {
  readonly operationId: string;
  readonly lotId: string;
  readonly expectedUpdatedAt: Date;
  readonly productName: string;
  readonly categoryName: string | null;
  readonly amount: Decimal;
  readonly storageLocationId: string | null;
  readonly storagePositionId: string | null;
  readonly expiryKind: ExpiryKind;
  readonly expiryDate: Date | null;
  readonly opened: boolean;
  readonly note: string | null;
}

/**
 * 在庫の内容を編集する。
 *
 * 数量が変わった場合は、直接書き換えず「訂正（ADJUST）」を1件積んで差分を反映する。
 * 数量以外（保管場所・期限・メモ）は履歴に残さない。
 *
 * 商品名・カテゴリの変更は、ロットの参照先を別の商品へ付け替えるのではなく、
 * **商品そのものの名前を直す**。付け替えると、すでに積んだ履歴の`productId`だけが
 * 古い商品を指したまま残り、商品軸の集計が合わなくなる。
 * （同じ商品の別のロットにも名前の変更が及ぶ点は、商品マスタとして正しい挙動。）
 */
export async function updateStockLot(
  ctx: InventoryContext,
  params: UpdateStockLotParams,
): Promise<RecordResult> {
  const householdId = await scope(ctx);
  const memberId = await findMemberId(householdId, ctx.userId);

  await assertStoragePlaceBelongs(householdId, params.storageLocationId, params.storagePositionId);
  const categoryId = await resolveCategoryId(householdId, params.categoryName);

  try {
    return await db.$transaction(async (tx) => {
      const duplicate = await findExistingTransaction(tx, householdId, params.operationId);
      if (duplicate) return duplicate;

      const lot = await loadLotForUpdate(tx, householdId, params.lotId);
      assertNotStale(lot.updatedAt, params.expectedUpdatedAt, lot.quantity, lot.unit);

      if (params.productName !== lot.product.name || categoryId !== lot.product.categoryId) {
        try {
          await tx.product.update({
            where: { id: lot.productId },
            data: { name: params.productName, categoryId },
          });
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
          throw new InventoryInputError(
            "productName",
            `「${params.productName}」という商品はすでにあります。別の名前にしてください。`,
          );
        }
      }

      const difference = params.amount.sub(new Decimal(lot.quantity));
      if (!difference.isZero()) {
        await tx.inventoryTransaction.create({
          data: {
            id: params.operationId,
            householdId,
            stockLotId: lot.id,
            productId: lot.productId,
            memberId,
            type: "ADJUST",
            quantityDelta: difference,
            unit: lot.unit,
            occurredAt: new Date(),
            note: "編集画面での訂正",
          },
        });
      }

      const next = quantity(params.amount, lot.unit);
      await tx.stockLot.update({
        where: { id: lot.id },
        data: {
          quantity: params.amount,
          status: nextLotStatus(next, "ADJUST"),
          storageLocationId: params.storageLocationId,
          storagePositionId: params.storagePositionId,
          bestBeforeDate: params.expiryKind === "BEST_BEFORE" ? params.expiryDate : null,
          useByDate: params.expiryKind === "USE_BY" ? params.expiryDate : null,
          noExpiry: params.expiryKind === "NONE",
          // すでに開封済みなら開封日時はそのまま残す（編集のたびに今日へ動かさない）。
          openedAt: params.opened ? (lot.openedAt ?? new Date()) : null,
          note: params.note,
        },
      });

      return { status: "recorded" as const, lotId: lot.id, transactionId: params.operationId };
    });
  } catch (error) {
    return (await resolveDuplicate(error, householdId, params.operationId)) ?? raise(error);
  }
}

/** 保管場所と詳細位置が、その家庭のもので、かつ位置がその場所の配下かを確かめる。 */
async function assertStoragePlaceBelongs(
  householdId: string,
  storageLocationId: string | null,
  storagePositionId: string | null,
): Promise<void> {
  if (storageLocationId) {
    const location = await db.storageLocation.findFirst({
      where: { id: storageLocationId, householdId },
      select: { id: true },
    });
    if (!location) throw new InventoryInputError("storageLocationId", "この保管場所は選べません。");
  }

  if (storagePositionId) {
    const position = await db.storagePosition.findFirst({
      where: { id: storagePositionId, householdId, storageLocationId: storageLocationId ?? undefined },
      select: { id: true },
    });
    if (!position) {
      throw new InventoryInputError("storagePositionId", "詳細位置は、選んだ保管場所の中から選んでください。");
    }
  }
}

/** カテゴリを、idまたは名前で解決する。名前のカテゴリが無ければ作る。 */
async function resolveCategoryId(
  householdId: string,
  categoryName: string | null | undefined,
): Promise<string | null> {
  const name = (categoryName ?? "").trim();
  if (name === "") return null;

  const existing = await db.category.findFirst({ where: { householdId, name }, select: { id: true } });
  if (existing) return existing.id;

  try {
    const created = await db.category.create({
      data: { householdId, name },
      select: { id: true },
    });
    return created.id;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // 同じ名前のカテゴリが同時に作られた場合は、先に入ったほうを使う。
    const raced = await db.category.findFirst({ where: { householdId, name }, select: { id: true } });
    return raced?.id ?? null;
  }
}

/** 商品を名前（＋ブランド）で解決する。未登録なら作る。 */
async function resolveProductId(
  householdId: string,
  name: string,
  brand: string,
  categoryId: string | null,
  defaultUnit: UnitCode,
): Promise<string> {
  const existing = await db.product.findFirst({
    where: { householdId, name, brand },
    select: { id: true },
  });
  if (existing) return existing.id;

  try {
    const created = await db.product.create({
      data: { householdId, name, brand, categoryId, defaultUnit },
      select: { id: true },
    });
    return created.id;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await db.product.findFirst({
      where: { householdId, name, brand },
      select: { id: true },
    });
    if (!raced) throw error;
    return raced.id;
  }
}

// ---------------------------------------------------------------------------
// 保管場所と詳細位置
// ---------------------------------------------------------------------------

/** 家庭を作った直後に、そのまま使い始められるようにする既定の保管場所。 */
export const DEFAULT_STORAGE_LOCATIONS: readonly (StorageLocationFormValue & {
  positions: readonly string[];
})[] = [
  { name: "冷蔵庫", kind: "REFRIGERATOR", temperatureZone: "CHILLED", positions: ["上段", "下段", "ドアポケット", "野菜室"] },
  { name: "冷凍庫", kind: "FREEZER", temperatureZone: "FROZEN", positions: ["上トレー", "引き出し"] },
  { name: "食品棚", kind: "PANTRY", temperatureZone: "AMBIENT", positions: ["上棚", "下棚"] },
  { name: "防災バッグ", kind: "EMERGENCY_STOCK", temperatureZone: "AMBIENT", positions: [] },
  { name: "洗面所", kind: "OTHER", temperatureZone: "AMBIENT", positions: ["洗面台下"] },
];

export async function createStorageLocation(
  ctx: InventoryContext,
  params: StorageLocationFormValue,
): Promise<{ id: string }> {
  const householdId = await scope(ctx);

  const last = await db.storageLocation.findFirst({
    where: { householdId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  try {
    return await db.storageLocation.create({
      data: { householdId, ...params, sortOrder: (last?.sortOrder ?? 0) + 1 },
      select: { id: true },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new InventoryInputError("name", `「${params.name}」はすでにあります。`);
    }
    throw error;
  }
}

/** 既定の保管場所をまとめて作る。すでにある名前は飛ばす。 */
export async function createDefaultStorageLocations(ctx: InventoryContext): Promise<number> {
  const householdId = await scope(ctx);
  let created = 0;

  for (const [index, location] of DEFAULT_STORAGE_LOCATIONS.entries()) {
    const { positions, ...fields } = location;
    const existing = await db.storageLocation.findFirst({
      where: { householdId, name: fields.name },
      select: { id: true },
    });
    if (existing) continue;

    const record = await db.storageLocation.create({
      data: { householdId, ...fields, sortOrder: index + 1 },
      select: { id: true },
    });
    created += 1;

    for (const [order, name] of positions.entries()) {
      await db.storagePosition.create({
        data: { householdId, storageLocationId: record.id, name, sortOrder: order + 1 },
      });
    }
  }

  return created;
}

export async function createStoragePosition(
  ctx: InventoryContext,
  params: { storageLocationId: string; name: string },
): Promise<{ id: string }> {
  const householdId = await scope(ctx);
  const name = params.name.trim();
  if (name === "") throw new InventoryInputError("positionName", "詳細位置の名前を入力してください。");

  const location = await db.storageLocation.findFirst({
    where: { id: params.storageLocationId, householdId },
    select: { id: true },
  });
  if (!location) throw new InventoryNotFoundError("この保管場所は見つかりませんでした。");

  const last = await db.storagePosition.findFirst({
    where: { householdId, storageLocationId: location.id },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  try {
    return await db.storagePosition.create({
      data: {
        householdId,
        storageLocationId: location.id,
        name,
        sortOrder: (last?.sortOrder ?? 0) + 1,
      },
      select: { id: true },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new InventoryInputError("positionName", `「${name}」はこの保管場所にすでにあります。`);
    }
    throw error;
  }
}

export async function renameStorageLocation(
  ctx: InventoryContext,
  params: { storageLocationId: string; name: string },
): Promise<void> {
  const householdId = await scope(ctx);
  const name = params.name.trim();
  if (name === "") throw new InventoryInputError("name", "保管場所の名前を入力してください。");

  const location = await db.storageLocation.findFirst({
    where: { id: params.storageLocationId, householdId },
    select: { id: true },
  });
  if (!location) throw new InventoryNotFoundError("この保管場所は見つかりませんでした。");

  try {
    await db.storageLocation.update({ where: { id: location.id }, data: { name } });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new InventoryInputError("name", `「${name}」はすでにあります。`);
    }
    throw error;
  }
}

/**
 * 保管場所を消す。在庫が残っている場所は消さない。
 *
 * ロットの外部キーは`onDelete: Restrict`なので消せばDBが弾くが、その場合に出るのは
 * 制約違反のエラーで、何をすれば消せるのかが利用者に伝わらない。ここで件数を見て理由を返す。
 */
export async function deleteStorageLocation(
  ctx: InventoryContext,
  params: { storageLocationId: string },
): Promise<void> {
  const householdId = await scope(ctx);

  const location = await db.storageLocation.findFirst({
    where: { id: params.storageLocationId, householdId },
    select: { id: true, name: true },
  });
  if (!location) throw new InventoryNotFoundError("この保管場所は見つかりませんでした。");

  const lots = await db.stockLot.count({ where: { householdId, storageLocationId: location.id } });
  if (lots > 0) {
    throw new InventoryConflictError(
      `「${location.name}」には在庫が${lots}件あります。先に別の場所へ移すか、使い切ってください。`,
    );
  }

  await db.storageLocation.delete({ where: { id: location.id } });
}

export async function deleteStoragePosition(
  ctx: InventoryContext,
  params: { storagePositionId: string },
): Promise<void> {
  const householdId = await scope(ctx);

  const position = await db.storagePosition.findFirst({
    where: { id: params.storagePositionId, householdId },
    select: { id: true, name: true },
  });
  if (!position) throw new InventoryNotFoundError("この詳細位置は見つかりませんでした。");

  const lots = await db.stockLot.count({ where: { householdId, storagePositionId: position.id } });
  if (lots > 0) {
    throw new InventoryConflictError(
      `「${position.name}」には在庫が${lots}件あります。先に別の位置へ移してください。`,
    );
  }

  await db.storagePosition.delete({ where: { id: position.id } });
}
