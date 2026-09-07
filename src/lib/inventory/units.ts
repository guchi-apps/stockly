import { Prisma } from "@prisma/client";
import type { $Enums } from "@prisma/client";

/**
 * 数量の単位と、その換算。
 *
 * 数量・容量・食数・使用回数はいずれも小数を取りうるため、値は`Prisma.Decimal`で扱う
 * （`number`は0.1+0.2が0.30000000000000004になり、在庫が合わなくなる）。
 *
 * 換算できない単位を黙って合算しないことがこのモジュールの主目的で、
 * 合算できない組み合わせは戻り値ではなく例外（`UnitConversionError`）で知らせる。
 */

export type UnitCode = $Enums.UnitCode;
export type UnitDimension = $Enums.UnitDimension;

export type Decimal = Prisma.Decimal;
export const Decimal = Prisma.Decimal;

export interface UnitDefinition {
  /** 単位の次元。次元が違えば換算できない。 */
  readonly dimension: UnitDimension;
  /** 同じ次元の基準単位。 */
  readonly base: UnitCode;
  /**
   * 基準単位へ換算する係数。`null`は「同じ単位としか合算できない」ことを表す。
   * 個数系（個・パック・本…）は商品ごとの入数が分からないと互いに換算できないため`null`にしてある。
   */
  readonly toBase: string | null;
  /** 画面表示用の単位記号。 */
  readonly label: string;
}

export const UNIT_DEFINITIONS: Readonly<Record<UnitCode, UnitDefinition>> = {
  PIECE: { dimension: "COUNT", base: "PIECE", toBase: null, label: "個" },
  PACK: { dimension: "COUNT", base: "PACK", toBase: null, label: "パック" },
  BOTTLE: { dimension: "COUNT", base: "BOTTLE", toBase: null, label: "本" },
  CAN: { dimension: "COUNT", base: "CAN", toBase: null, label: "缶" },
  BAG: { dimension: "COUNT", base: "BAG", toBase: null, label: "袋" },
  BOX: { dimension: "COUNT", base: "BOX", toBase: null, label: "箱" },
  ROLL: { dimension: "COUNT", base: "ROLL", toBase: null, label: "ロール" },
  MILLILITER: { dimension: "VOLUME", base: "MILLILITER", toBase: "1", label: "mL" },
  LITER: { dimension: "VOLUME", base: "MILLILITER", toBase: "1000", label: "L" },
  GRAM: { dimension: "MASS", base: "GRAM", toBase: "1", label: "g" },
  KILOGRAM: { dimension: "MASS", base: "GRAM", toBase: "1000", label: "kg" },
  SERVING: { dimension: "SERVING", base: "SERVING", toBase: "1", label: "食" },
  USE: { dimension: "USE", base: "USE", toBase: "1", label: "回" },
};

/** 換算できない単位どうしを合算・比較しようとしたときに投げる。 */
export class UnitConversionError extends Error {
  readonly from: UnitCode;
  readonly to: UnitCode;

  constructor(from: UnitCode, to: UnitCode) {
    super(
      `単位 ${from} を ${to} へ換算できません。` +
        "換算できない単位の数量は合算せず、単位ごとに分けて扱ってください。",
    );
    this.name = "UnitConversionError";
    this.from = from;
    this.to = to;
  }
}

/** 単位つきの数量。 */
export interface Quantity {
  readonly amount: Decimal;
  readonly unit: UnitCode;
}

export function quantity(amount: Decimal | string | number, unit: UnitCode): Quantity {
  return { amount: new Decimal(amount), unit };
}

export function unitDefinition(unit: UnitCode): UnitDefinition {
  return UNIT_DEFINITIONS[unit];
}

/** `from`から`to`へ換算できるか。同じ単位なら常に換算できる。 */
export function canConvert(from: UnitCode, to: UnitCode): boolean {
  if (from === to) return true;

  const source = UNIT_DEFINITIONS[from];
  const target = UNIT_DEFINITIONS[to];
  if (source.dimension !== target.dimension) return false;

  // 個数系のように基準単位を持たない単位は、同じ単位としか合算できない。
  return source.toBase !== null && target.toBase !== null;
}

/** 数量を別の単位へ換算する。換算できない場合は`UnitConversionError`。 */
export function convertQuantity(value: Quantity, to: UnitCode): Quantity {
  if (value.unit === to) return value;
  if (!canConvert(value.unit, to)) {
    throw new UnitConversionError(value.unit, to);
  }

  const source = UNIT_DEFINITIONS[value.unit];
  const target = UNIT_DEFINITIONS[to];
  // canConvert()がtrueならtoBaseは両方non-null。
  const inBase = value.amount.mul(new Decimal(source.toBase as string));
  return { amount: inBase.div(new Decimal(target.toBase as string)), unit: to };
}

/**
 * 数量を合算する。
 *
 * `targetUnit`を省略した場合は最初の要素の単位に揃える。空配列を渡すときは
 * 単位が決まらないため`targetUnit`が必須。
 */
export function sumQuantities(values: readonly Quantity[], targetUnit?: UnitCode): Quantity {
  const unit = targetUnit ?? values[0]?.unit;
  if (unit === undefined) {
    throw new Error("空の数量を合算するには targetUnit が必要です。");
  }

  let total = new Decimal(0);
  for (const value of values) {
    total = total.add(convertQuantity(value, unit).amount);
  }
  return { amount: total, unit };
}

export function addQuantities(a: Quantity, b: Quantity): Quantity {
  return sumQuantities([a, b], a.unit);
}

export function subtractQuantities(a: Quantity, b: Quantity): Quantity {
  return {
    amount: a.amount.sub(convertQuantity(b, a.unit).amount),
    unit: a.unit,
  };
}

/** `a`が`b`より小さければ負、等しければ0、大きければ正を返す。 */
export function compareQuantities(a: Quantity, b: Quantity): number {
  return a.amount.comparedTo(convertQuantity(b, a.unit).amount);
}

export function isSameQuantity(a: Quantity, b: Quantity): boolean {
  return compareQuantities(a, b) === 0;
}

/**
 * 換算できない単位が混ざった数量の集まりを、合算できる単位ごとにまとめる。
 * 一覧表示のように「合算できないものも落とさず出したい」場面で使う。
 */
export function groupSummableQuantities(values: readonly Quantity[]): Quantity[] {
  const groups: Quantity[] = [];
  for (const value of values) {
    const index = groups.findIndex((group) => canConvert(value.unit, group.unit));
    if (index === -1) {
      groups.push({ amount: new Decimal(value.amount), unit: value.unit });
    } else {
      groups[index] = addQuantities(groups[index], value);
    }
  }
  return groups;
}

/** 画面表示用の文字列。末尾の余分な0は落とす（1.500 → 1.5）。 */
export function formatQuantity(value: Quantity): string {
  return `${value.amount.toDecimalPlaces(3).toString()}${UNIT_DEFINITIONS[value.unit].label}`;
}
