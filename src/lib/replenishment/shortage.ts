/**
 * 補充基準と在庫から「いくつ足りないか」を出す純関数。
 *
 * ここにはPrismaもNext.jsも持ち込まない（DBの無いCIで判定を単体テストできるようにするため。
 * `shortage.test.ts`）。DBからの読み出しは`queries.ts`、書き込みは`service.ts`が担う。
 *
 * 判定の前提は3つ。
 *
 * 1. **基準の判定単位へ換算できない在庫は数えない。** 個とパックのように、商品ごとの入数が
 *    分からないと換算できない組み合わせがある（`src/lib/inventory/units.ts`）。黙って足すと
 *    「2パックあるから足りている」と誤判定して買い忘れる。数えなかった件数は画面に出す。
 *    ただし**商品が1単位あたりの内容量・食数・使用回数を持っていれば、そこを通して換算する**
 *    （`Product.contentAmount`／`contentUnit`・`servingsPerUnit`・`usesPerUnit`。「1本 = 2L」が
 *    分かっていれば、Lの基準でボトルの在庫を数えられる）。入数が分かっているものだけを
 *    換算するので、上の前提は崩れない。
 * 2. **期限切れの在庫は数えない。** 期限切れのサトウのごはんが4パックあっても、買い足す必要は
 *    消えない。除いた件数は画面に出す。
 * 3. **不足量は「目標 − 現在数量」**。現在数量が基準以下のときだけ候補にする。
 */
import {
  Decimal,
  UNIT_DEFINITIONS,
  canConvert,
  convertQuantity,
  type Quantity,
  type UnitCode,
} from "../inventory/units.ts";

/** 補充基準の対象。商品ごと、またはカテゴリごと。 */
export const REPLENISHMENT_TARGET_KINDS = ["PRODUCT", "CATEGORY"] as const;
export type ReplenishmentTargetKind = (typeof REPLENISHMENT_TARGET_KINDS)[number];

export const TARGET_KIND_LABELS: Readonly<Record<ReplenishmentTargetKind, string>> = {
  PRODUCT: "商品",
  CATEGORY: "カテゴリ",
};

export interface ReplenishmentTarget {
  readonly kind: ReplenishmentTargetKind;
  readonly id: string;
  readonly name: string;
}

/** 判定に使う在庫1件ぶん。`queries.ts`がStockLotから組み立てる。 */
export interface StockSnapshot {
  readonly amount: Decimal;
  readonly unit: UnitCode;
  /** 期限切れかどうか。切れているものは「これから使える量」に数えない。 */
  readonly expired: boolean;
  /**
   * その商品の1単位あたりの内容量・食数・使用回数（例: 1本 = 2000mL、1パック = 1食）。
   * 分かっている場合だけ、単位の次元をまたいだ換算に使う
   * （`Product.contentAmount`／`contentUnit`・`servingsPerUnit`・`usesPerUnit`）。
   */
  readonly perUnitEquivalents?: readonly Quantity[] | null;
}

/** 判定に必要なぶんだけを取り出した補充基準。 */
export interface ReplenishmentRuleSnapshot {
  readonly ruleId: string;
  readonly target: ReplenishmentTarget;
  readonly thresholdAmount: Decimal;
  readonly targetAmount: Decimal;
  readonly unit: UnitCode;
}

export interface ShortageResult {
  readonly ruleId: string;
  readonly target: ReplenishmentTarget;
  readonly unit: UnitCode;
  readonly thresholdAmount: Decimal;
  readonly targetAmount: Decimal;
  /** 判定単位へ換算して合計した現在数量。 */
  readonly currentAmount: Decimal;
  /** 目標までの不足量。足りていれば0。 */
  readonly shortageAmount: Decimal;
  /** 基準を下回っていて、かつ不足量が0より大きいか。 */
  readonly isShort: boolean;
  /** 判定単位へ換算できず、数えなかった在庫の件数。 */
  readonly unconvertibleLotCount: number;
  /** 期限切れのため数えなかった在庫の件数。 */
  readonly expiredLotCount: number;
}

/** DB側の`Decimal(14, 3)`に合わせ、小数は3桁までで扱う。 */
const QUANTITY_SCALE = 3;

/**
 * 在庫1件を判定単位へ換算する。換算できなければ`null`。
 *
 * 直接換算できないときだけ、商品が持つ「1単位あたり」の値を順に試す。
 * どれも使えない商品は、ここで`null`になって「数えなかった在庫」として数えられる。
 */
function toRuleUnit(lot: StockSnapshot, unit: UnitCode): Quantity | null {
  if (canConvert(lot.unit, unit)) {
    return convertQuantity({ amount: lot.amount, unit: lot.unit }, unit);
  }

  for (const perUnit of lot.perUnitEquivalents ?? []) {
    if (!canConvert(perUnit.unit, unit)) continue;
    return convertQuantity({ amount: lot.amount.mul(perUnit.amount), unit: perUnit.unit }, unit);
  }

  return null;
}

/** 基準1件ぶんの判定。 */
export function calculateShortage(
  rule: ReplenishmentRuleSnapshot,
  lots: readonly StockSnapshot[],
): ShortageResult {
  let current = new Decimal(0);
  let unconvertibleLotCount = 0;
  let expiredLotCount = 0;

  for (const lot of lots) {
    if (lot.expired) {
      expiredLotCount += 1;
      continue;
    }
    const converted = toRuleUnit(lot, rule.unit);
    if (!converted) {
      unconvertibleLotCount += 1;
      continue;
    }
    current = current.add(converted.amount);
  }

  current = current.toDecimalPlaces(QUANTITY_SCALE);
  const shortage = rule.targetAmount.sub(current).toDecimalPlaces(QUANTITY_SCALE);
  // Decimalの`isPositive()`は0でもtrueを返すため、0より大きいことを明示して比べる。
  const isShort = current.lessThanOrEqualTo(rule.thresholdAmount) && shortage.greaterThan(0);

  return {
    ruleId: rule.ruleId,
    target: rule.target,
    unit: rule.unit,
    thresholdAmount: rule.thresholdAmount,
    targetAmount: rule.targetAmount,
    currentAmount: current,
    shortageAmount: shortage.greaterThan(0) ? shortage : new Decimal(0),
    isShort,
    unconvertibleLotCount,
    expiredLotCount,
  };
}

/**
 * 基準をまとめて判定する。
 *
 * `lotsByRuleId`には、その基準の対象（商品またはカテゴリ）に属する在庫だけを渡す。
 * どの在庫がどの基準に属するかの割り当ては`queries.ts`が行う。
 */
export function calculateShortages(
  rules: readonly ReplenishmentRuleSnapshot[],
  lotsByRuleId: ReadonlyMap<string, readonly StockSnapshot[]>,
): ShortageResult[] {
  return rules.map((rule) => calculateShortage(rule, lotsByRuleId.get(rule.ruleId) ?? []));
}

/** 不足が大きい順（同数なら名前順）に並べる。買い足す量が多いものほど先に目に入るようにする。 */
export function compareByShortage(a: ShortageResult, b: ShortageResult): number {
  const diff = b.shortageAmount.comparedTo(a.shortageAmount);
  if (diff !== 0) return diff;
  return a.target.name.localeCompare(b.target.name, "ja");
}

export function formatAmountWithUnit(amount: Decimal, unit: UnitCode): string {
  return `${amount.toDecimalPlaces(QUANTITY_SCALE).toString()}${UNIT_DEFINITIONS[unit].label}`;
}

/** 「2ロール以下になったら12ロールまで」。基準の一覧と候補の説明に使う。 */
export function describeRule(rule: {
  thresholdAmount: Decimal;
  targetAmount: Decimal;
  unit: UnitCode;
}): string {
  return `${formatAmountWithUnit(rule.thresholdAmount, rule.unit)}以下になったら${formatAmountWithUnit(rule.targetAmount, rule.unit)}まで`;
}
