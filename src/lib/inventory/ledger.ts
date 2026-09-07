import type { $Enums } from "@prisma/client";
import {
  Decimal,
  convertQuantity,
  quantity,
  sumQuantities,
  type Quantity,
  type UnitCode,
} from "./units.ts";

/**
 * 入出庫履歴（`InventoryTransaction`）から在庫数量を組み立てる。
 *
 * 履歴はappend-onlyで、既存行のUPDATE/DELETEは行わない。取消は
 * 「符号を反転した`REVERSAL`行を足す」ことで表すため、現在数量は常に
 * `quantityDelta`の単純合計で復元できる（取消済みの行を除外する必要はない）。
 *
 * `StockLot.quantity`はこの合計を保持する集計値で、正本は履歴のほう。
 * ずれは`verifyLotQuantity()`で検出する。
 */

export type InventoryTransactionType = $Enums.InventoryTransactionType;

/** 数量計算に必要な履歴の部分集合。Prismaの`InventoryTransaction`をそのまま渡せる。 */
export interface LedgerEntry {
  readonly id: string;
  readonly type: InventoryTransactionType;
  readonly quantityDelta: Decimal;
  readonly unit: UnitCode;
  readonly reversesTransactionId: string | null;
}

/** 履歴として成立しない操作を拒否するときに投げる。 */
export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerError";
  }
}

/**
 * 種別ごとに許される`quantityDelta`の符号。
 * `ADJUST`（訂正）と`REVERSAL`（取消）は増減どちらもありうるので0以外なら通す。
 */
const REQUIRED_SIGN: Readonly<Record<InventoryTransactionType, 1 | -1 | 0>> = {
  PURCHASE: 1,
  CONSUME: -1,
  DISPOSE: -1,
  ADJUST: 0,
  REVERSAL: 0,
};

/**
 * 種別と符号が矛盾していないかを検証する。
 * 「消費なのに数量が増える」といった履歴が積まれると、以後の再計算がすべて狂う。
 */
export function assertDeltaSign(type: InventoryTransactionType, delta: Decimal): void {
  if (delta.isZero()) {
    throw new LedgerError("quantityDeltaに0は記録できません。");
  }

  const required = REQUIRED_SIGN[type];
  if (required === 1 && delta.isNegative()) {
    throw new LedgerError(`${type}のquantityDeltaは正の数でなければなりません。`);
  }
  if (required === -1 && delta.isPositive()) {
    throw new LedgerError(`${type}のquantityDeltaは負の数でなければなりません。`);
  }
}

/**
 * 履歴からロットの現在数量を再計算する。
 * `unit`と換算できない単位の履歴が混ざっていれば`UnitConversionError`が飛ぶ。
 */
export function computeLotQuantity(entries: readonly LedgerEntry[], unit: UnitCode): Quantity {
  return sumQuantities(
    entries.map((entry) => quantity(entry.quantityDelta, entry.unit)),
    unit,
  );
}

/** 指定した履歴を取り消している`REVERSAL`行を探す。 */
export function findReversalOf(
  target: LedgerEntry,
  entries: readonly LedgerEntry[],
): LedgerEntry | undefined {
  return entries.find((entry) => entry.reversesTransactionId === target.id);
}

export function isReversed(target: LedgerEntry, entries: readonly LedgerEntry[]): boolean {
  return findReversalOf(target, entries) !== undefined;
}

/** `REVERSAL`行として新規に積む内容。 */
export interface ReversalInput {
  readonly type: "REVERSAL";
  readonly quantityDelta: Decimal;
  readonly unit: UnitCode;
  readonly reversesTransactionId: string;
}

/**
 * 取消行の内容を組み立てる。
 *
 * 取消の取消と二重取消は履歴の意味が壊れるため拒否する
 * （DB側でも`@@unique([householdId, reversesTransactionId])`で二重取消を弾いている）。
 */
export function buildReversal(
  target: LedgerEntry,
  entries: readonly LedgerEntry[],
): ReversalInput {
  if (target.type === "REVERSAL") {
    throw new LedgerError("取消（REVERSAL）を取り消すことはできません。");
  }
  if (isReversed(target, entries)) {
    throw new LedgerError(`transaction ${target.id} はすでに取り消されています。`);
  }

  return {
    type: "REVERSAL",
    quantityDelta: target.quantityDelta.negated(),
    unit: target.unit,
    reversesTransactionId: target.id,
  };
}

/** ロットが保持する集計値と履歴の再計算結果の突き合わせ結果。 */
export interface LotConsistencyResult {
  readonly consistent: boolean;
  /** `StockLot.quantity`が持っている値。 */
  readonly stored: Quantity;
  /** 履歴から再計算した値。 */
  readonly computed: Quantity;
  /** `computed - stored`。0でなければ集計値がずれている。 */
  readonly difference: Quantity;
}

/**
 * 集計値`StockLot.quantity`が履歴と一致しているかを検証する。
 * 一致しない場合でも例外は投げず、差分を返す（棚卸・バッチ検証で一覧したいため）。
 */
export function verifyLotQuantity(
  lot: { readonly quantity: Decimal; readonly unit: UnitCode },
  entries: readonly LedgerEntry[],
): LotConsistencyResult {
  const stored = quantity(lot.quantity, lot.unit);
  const computed = computeLotQuantity(entries, lot.unit);
  const difference = {
    amount: computed.amount.sub(convertQuantity(stored, computed.unit).amount),
    unit: computed.unit,
  };

  return {
    consistent: difference.amount.isZero(),
    stored,
    computed,
    difference,
  };
}

/**
 * 履歴を1件積んだあとのロット数量を求める。
 * 数量を直接書き換えず、必ず履歴を通して更新するための入口。
 */
export function applyEntry(
  current: Quantity,
  entry: Pick<LedgerEntry, "type" | "quantityDelta" | "unit">,
): Quantity {
  assertDeltaSign(entry.type, entry.quantityDelta);
  return sumQuantities([current, quantity(entry.quantityDelta, entry.unit)], current.unit);
}

/** 在庫が尽きたか（0以下になったか）。 */
export function isDepleted(current: Quantity): boolean {
  return current.amount.lessThanOrEqualTo(new Decimal(0));
}
