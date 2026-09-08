/**
 * 在庫から「非常時に何日ぶんあるか」を出す純関数（#7）。
 *
 * ここにはPrismaもNext.jsも持ち込まない（`assess.test.ts`がDBの無いCIで回るようにするため）。
 * DBからの読み出しは`queries.ts`。
 *
 * 判定の前提は5つ。**どれも「過大評価を避ける側へ倒す」ためにある。**
 *
 * 1. **冷蔵・冷凍の在庫は数えない。** 停電すれば使えなくなるため。含めるには基準の
 *    `includeChilled`／`includeFrozen`を明示的に立てる（受入条件の「明示設定なしに
 *    例外化しない」）。温度帯は商品と保管場所の**厳しいほう**を採る
 *    （`strictestTemperatureZone()`。常温品でも冷蔵庫に入っていれば温まる）
 * 2. **期限切れと期限が未確認の在庫は数えない。** 期限切れのサトウのごはんが4パックあっても
 *    非常時の食料にはならない。未確認（`UNKNOWN`）を期限内に混ぜないのは#5と同じ理由で、
 *    こちらは**基準にかかわらず**数えない
 * 3. **開封済み（飲みかけ・使いかけ）は既定で数えない。** 残量と衛生状態が分からないため。
 *    基準の`includeOpened`で数えることもできる
 * 4. **判定単位へ換算できない在庫は数えない。** トイレットペーパー0.4ロールは「携帯トイレ何回ぶん」
 *    へは換算できない。商品が内容量・食数・使用回数を持っていればそこを通して換算する
 *    （#6の`shortage.ts`と同じ考え方）
 * 5. **加熱・水が要る食料は、熱源・飲料水があるときだけ数える**（既定）。カセットボンベが
 *    無ければカップ麺は食べられない。これは他の区分の在庫に依存する判定なので、
 *    **2周に分けて評価する**（1周目で熱源と飲料水の有無を出し、2周目で本判定を行う）。
 *    区分の依存はこの一方向だけで、循環しない
 *
 * 外した在庫は捨てずに`excludedLots`へ理由つきで残す。件数だけでなく中身まで返すのは、
 * 受入条件の「根拠となる在庫ロットと除外理由を追跡できる」を画面で満たすため。
 */
import {
  canConvert,
  convertQuantity,
  Decimal,
  type Quantity,
  type UnitCode,
} from "../inventory/units.ts";
import type { ExpiryState } from "../inventory/operations.ts";

import {
  DISASTER_CATEGORY_RULES,
  DISASTER_RULE_VERSION,
  categoryOfRole,
  dailyConsumption,
  requiredAmount,
  strictestTemperatureZone,
  type DisasterCategory,
  type DisasterCategoryRule,
  type DisasterPlanValue,
  type EmergencyRole,
  type TemperatureZone,
} from "./rules.ts";

/** DB側の`Decimal(14, 3)`に合わせ、小数は3桁までで扱う。 */
const QUANTITY_SCALE = 3;

/** 判定に使う在庫1件ぶん。`queries.ts`が`StockLot`から組み立てる。 */
export interface DisasterLotSnapshot {
  readonly lotId: string;
  readonly productName: string;
  readonly amount: Decimal;
  readonly unit: UnitCode;
  readonly role: EmergencyRole;
  /** 商品そのものの温度帯。 */
  readonly productZone: TemperatureZone;
  /** 置いてある保管場所の温度帯。保管場所が未設定なら`null`。 */
  readonly storageZone: TemperatureZone | null;
  readonly requiresHeating: boolean;
  readonly requiresWater: boolean;
  /** 開封済みか（`StockLot.openedAt`が入っているか）。 */
  readonly opened: boolean;
  /** 期限の状態。`resolveExpiry()`の結果をそのまま渡す。 */
  readonly expiry: ExpiryState;
  /** 「1本 = 2L」「1パック = 1食」のような、単位の壁を越えた換算に使う値。 */
  readonly perUnitEquivalents: readonly Quantity[];
}

/** 数えなかった理由。画面にはこの順で意味を出す。 */
export const DISASTER_EXCLUSION_REASONS = [
  "NOT_POSITIVE",
  "EXPIRED",
  "UNKNOWN_EXPIRY",
  "CHILLED",
  "FROZEN",
  "OPENED",
  "NO_HEAT_SOURCE",
  "NO_WATER",
  "UNCONVERTIBLE",
] as const;
export type DisasterExclusionReason = (typeof DISASTER_EXCLUSION_REASONS)[number];

export const EXCLUSION_REASON_LABELS: Readonly<Record<DisasterExclusionReason, string>> = {
  NOT_POSITIVE: "残量なし",
  EXPIRED: "期限切れ",
  UNKNOWN_EXPIRY: "期限が要確認",
  CHILLED: "冷蔵",
  FROZEN: "冷凍",
  OPENED: "開封済み",
  NO_HEAT_SOURCE: "熱源がない",
  NO_WATER: "水がない",
  UNCONVERTIBLE: "換算できない",
};

export const EXCLUSION_REASON_NOTES: Readonly<Record<DisasterExclusionReason, string>> = {
  NOT_POSITIVE: "数量が0以下です",
  EXPIRED: "非常時の備えには数えません",
  UNKNOWN_EXPIRY: "期限を入れると次から数えます",
  CHILLED: "停電で使えなくなる前提です",
  FROZEN: "停電で使えなくなる前提です",
  OPENED: "残量と衛生状態が分からないためです",
  NO_HEAT_SOURCE: "加熱しないと食べられません",
  NO_WATER: "水がないと食べられません",
  UNCONVERTIBLE: "この区分の単位へ換算できません",
};

/** 在庫1件の判定結果。算入したものも外したものも同じ形で返す。 */
export interface DisasterLotVerdict {
  readonly lot: DisasterLotSnapshot;
  /** 候補になった区分。役割がどの区分にも当たらない在庫はそもそも判定に入らない。 */
  readonly category: DisasterCategory;
  /** 判定単位へ換算した量。換算できなかった場合は`null`。 */
  readonly countedAmount: Decimal | null;
  /** 数えなかった理由。算入した場合は`null`。 */
  readonly exclusion: DisasterExclusionReason | null;
}

export interface DisasterCategoryResult {
  readonly rule: DisasterCategoryRule;
  readonly requiredAmount: Decimal;
  readonly includedAmount: Decimal;
  /** 目標までの不足量。足りていれば0。 */
  readonly shortageAmount: Decimal;
  /** 何日ぶんあるか。日数で減らない区分（照明・電源）は`null`。 */
  readonly coverageDays: Decimal | null;
  readonly isMet: boolean;
  readonly includedLots: readonly DisasterLotVerdict[];
  readonly excludedLots: readonly DisasterLotVerdict[];
}

export interface DisasterAssessment {
  readonly ruleVersion: string;
  readonly plan: DisasterPlanValue;
  readonly categories: readonly DisasterCategoryResult[];
  /**
   * 全体の備蓄日数。**日数を出せる区分のうち、いちばん短いもの**。
   * 平均にすると、水だけ足りている家庭が「2日ぶんある」と読めてしまう。
   */
  readonly coverageDays: Decimal | null;
  /** 全区分が目標に届いているか。 */
  readonly meetsTarget: boolean;
  /** 数えなかった在庫（全区分ぶん）。 */
  readonly excludedLots: readonly DisasterLotVerdict[];
}

/** 在庫1件を区分の判定単位へ換算する。換算できなければ`null`。 */
function toCategoryUnit(lot: DisasterLotSnapshot, rule: DisasterCategoryRule): Decimal | null {
  if (canConvert(lot.unit, rule.unit)) {
    return convertQuantity({ amount: lot.amount, unit: lot.unit }, rule.unit).amount;
  }
  for (const perUnit of lot.perUnitEquivalents) {
    if (!canConvert(perUnit.unit, rule.unit)) continue;
    return convertQuantity({ amount: lot.amount.mul(perUnit.amount), unit: perUnit.unit }, rule.unit)
      .amount;
  }
  return null;
}

/** 他の区分に依存しない除外条件。1周目・2周目のどちらでも同じ判定になる。 */
function baseExclusion(
  lot: DisasterLotSnapshot,
  plan: DisasterPlanValue,
): DisasterExclusionReason | null {
  // Decimalの`isPositive()`は0でもtrueを返すため、0より大きいことを明示して比べる。
  if (!lot.amount.greaterThan(0)) return "NOT_POSITIVE";
  if (lot.expiry.status === "EXPIRED") return "EXPIRED";
  // 期限が未確認のものは基準にかかわらず数えない（「期限なし」と決めたものは数える）。
  if (lot.expiry.status === "UNKNOWN") return "UNKNOWN_EXPIRY";

  const zone = strictestTemperatureZone(lot.productZone, lot.storageZone);
  if (zone === "CHILLED" && !plan.includeChilled) return "CHILLED";
  if (zone === "FROZEN" && !plan.includeFrozen) return "FROZEN";

  if (lot.opened && !plan.includeOpened) return "OPENED";
  return null;
}

/**
 * 加熱・水が要る食料を数えてよいかの前提。
 *
 * **どの範囲の在庫から出すかは呼び出し側が決められる。** 家庭全体の判定では渡された在庫から
 * そのまま出すが、防災バッグ1つに絞った判定（#8）では**家全体の熱源・飲料水**を見る必要がある。
 * バッグの中だけで見ると、家にカセットボンベがあってもバッグに入っていない限り
 * 「熱源がない」でカップ麺が落ち、点検の画面が実態より厳しく出る。
 */
export interface DisasterAvailability {
  readonly hasHeatSource: boolean;
  readonly hasWater: boolean;
}

/** 在庫1件を判定する。`availability`が`null`の周では、加熱・水の判定を行わない。 */
function judge(
  lot: DisasterLotSnapshot,
  rule: DisasterCategoryRule,
  plan: DisasterPlanValue,
  availability: DisasterAvailability | null,
): DisasterLotVerdict {
  const countedAmount = toCategoryUnit(lot, rule);
  const base = baseExclusion(lot, plan);

  let exclusion = base;
  if (!exclusion && availability) {
    if (lot.requiresHeating && plan.requireHeatSourceForHeating && !availability.hasHeatSource) {
      exclusion = "NO_HEAT_SOURCE";
    } else if (lot.requiresWater && plan.requireWaterForRehydration && !availability.hasWater) {
      exclusion = "NO_WATER";
    }
  }
  if (!exclusion && countedAmount === null) exclusion = "UNCONVERTIBLE";

  return { lot, category: rule.key, countedAmount, exclusion };
}

function sumIncluded(verdicts: readonly DisasterLotVerdict[]): Decimal {
  let total = new Decimal(0);
  for (const verdict of verdicts) {
    if (verdict.exclusion || !verdict.countedAmount) continue;
    total = total.add(verdict.countedAmount);
  }
  return total.toDecimalPlaces(QUANTITY_SCALE);
}

/**
 * 1周目。加熱・水の判定を切って、熱源と飲料水が実際にあるかだけを見る。
 *
 * ここだけを別に呼べるようにしてあるのは、**算入量を数える範囲と、供給の有無を見る範囲を
 * 分けたい場面があるため**（#8の防災バッグ。バッグの中身だけを数えつつ、熱源と水は家全体で見る）。
 * 依存はこの一方向だけで、循環しない。
 */
export function resolveAvailability(
  lots: readonly DisasterLotSnapshot[],
  plan: DisasterPlanValue,
): DisasterAvailability {
  const of = (key: "HEAT" | "WATER"): boolean => {
    const rule = DISASTER_CATEGORY_RULES.find((item) => item.key === key) as DisasterCategoryRule;
    return sumIncluded(
      lots
        .filter((lot) => categoryOfRole(lot.role) === key)
        .map((lot) => judge(lot, rule, plan, null)),
    ).greaterThan(0);
  };
  return { hasHeatSource: of("HEAT"), hasWater: of("WATER") };
}

/**
 * 在庫をまとめて判定する。
 *
 * `lots`には家庭の在庫をそのまま渡してよい。役割がどの区分にも当たらないもの
 * （`NONE`・`UTILITY_WATER`・`MEDICAL`・`OTHER`）は、防災の候補ではないのでここで落とす
 * （「数えなかった在庫」にも出さない——外したのではなく、はじめから対象外のため）。
 *
 * `availability`を省略すると`lots`から出す（家庭全体の判定はこれでよい）。**在庫の一部だけを
 * 渡すときは、供給の有無を家庭全体から出して明示的に渡すこと**——渡さないと、熱源や水が
 * 別の場所にあっても「無い」と判定される（#8の防災バッグ）。
 */
export function assessDisasterStock(
  lots: readonly DisasterLotSnapshot[],
  plan: DisasterPlanValue,
  ruleVersion: string = DISASTER_RULE_VERSION,
  availability: DisasterAvailability = resolveAvailability(lots, plan),
): DisasterAssessment {
  const byCategory = new Map<DisasterCategory, DisasterLotSnapshot[]>();
  for (const rule of DISASTER_CATEGORY_RULES) byCategory.set(rule.key, []);
  for (const lot of lots) {
    const key = categoryOfRole(lot.role);
    if (!key) continue;
    byCategory.get(key)?.push(lot);
  }

  // 2周目。1周目（`resolveAvailability()`）で分かった供給を前提に本判定する。
  const categories = DISASTER_CATEGORY_RULES.map((rule) => {
    const verdicts = (byCategory.get(rule.key) ?? []).map((lot) =>
      judge(lot, rule, plan, availability),
    );
    const includedLots = verdicts.filter((verdict) => !verdict.exclusion);
    const excludedLots = verdicts.filter((verdict) => verdict.exclusion);

    const included = sumIncluded(includedLots);
    const required = requiredAmount(rule, plan).toDecimalPlaces(QUANTITY_SCALE);
    const shortage = required.sub(included).toDecimalPlaces(QUANTITY_SCALE);
    const perDay = dailyConsumption(rule, plan);

    return {
      rule,
      requiredAmount: required,
      includedAmount: included,
      shortageAmount: shortage.greaterThan(0) ? shortage : new Decimal(0),
      coverageDays: perDay ? included.div(perDay).toDecimalPlaces(QUANTITY_SCALE) : null,
      isMet: !shortage.greaterThan(0),
      includedLots,
      excludedLots,
    } satisfies DisasterCategoryResult;
  });

  const dayed = categories
    .map((category) => category.coverageDays)
    .filter((days): days is Decimal => days !== null);
  const coverageDays = dayed.length === 0 ? null : dayed.reduce((a, b) => (a.lessThan(b) ? a : b));

  return {
    ruleVersion,
    plan,
    categories,
    coverageDays,
    meetsTarget: categories.every((category) => category.isMet),
    excludedLots: categories.flatMap((category) => category.excludedLots),
  };
}

/** 数えなかった在庫を理由ごとにまとめる。画面の内訳と件数に使う。 */
export function groupExclusions(
  verdicts: readonly DisasterLotVerdict[],
): { reason: DisasterExclusionReason; label: string; note: string; lots: DisasterLotVerdict[] }[] {
  return DISASTER_EXCLUSION_REASONS.map((reason) => ({
    reason,
    label: EXCLUSION_REASON_LABELS[reason],
    note: EXCLUSION_REASON_NOTES[reason],
    lots: verdicts.filter((verdict) => verdict.exclusion === reason),
  })).filter((group) => group.lots.length > 0);
}
