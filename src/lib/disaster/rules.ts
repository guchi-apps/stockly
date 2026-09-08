/**
 * 防災ストックの判定ルール（#7）。
 *
 * ここにはPrismaクライアントもNext.jsも持ち込まない（DBの無いCIで判定を単体テストできるように
 * するため。`assess.test.ts`）。DBからの読み出しは`queries.ts`、基準の保存は`settings.ts`。
 *
 * このモジュールが持つのは次の3つ。
 *
 * 1. **ルールの版**（`DISASTER_RULE_VERSION`）。判定結果と保存済みの基準の両方に埋め、
 *    「どの規則で出した数字か」を後から辿れるようにする。区分の追加・必要量の意味の変更・
 *    除外条件の変更のように**同じ在庫から違う数字が出るようになったら版を上げる**
 *    （文言や並び順だけの変更では上げない）。
 * 2. **6区分の定義**（`DISASTER_CATEGORY_RULES`）。`EmergencyRole`をどの区分で、どの単位で
 *    数えるか。ここに載っていない役割（`NONE`・`UTILITY_WATER`・`MEDICAL`・`OTHER`）は
 *    防災の集計に出てこない。`EmergencyRole`へ値を足すときは、ここも一緒に直す。
 * 3. **必要量の伸び方**（`scale`）。人数と日数のどちらで増えるかは区分によって違う。
 *    水や食事は人日で増えるが、ライトは「1人1個」で日数では増えず、カセットボンベは
 *    「1日1回」で人数では増えない（家族で1つの火を使う）。
 */
import type { $Enums } from "@prisma/client";

import { InventoryInputError, type ParseResult, type RawInput } from "../inventory/operations.ts";
import { Decimal, UNIT_DEFINITIONS, type UnitCode } from "../inventory/units.ts";

export type EmergencyRole = $Enums.EmergencyRole;
export type TemperatureZone = $Enums.TemperatureZone;

/**
 * 判定ルールの版。**同じ在庫・同じ基準・同じ版なら、必ず同じ結果になる**
 * （`assess.ts`は乱数も暗黙の現在時刻参照も持たない純関数）。
 */
export const DISASTER_RULE_VERSION = "v1";

/** 防災の集計軸。受入条件の「食料・飲料・衛生用品・照明・電源・熱源を別々に集計する」。 */
export const DISASTER_CATEGORIES = [
  "FOOD",
  "WATER",
  "SANITATION",
  "LIGHTING",
  "POWER",
  "HEAT",
] as const;
export type DisasterCategory = (typeof DISASTER_CATEGORIES)[number];

/**
 * 必要量の伸び方。
 *
 * - `PERSON_DAY`: 人数 × 日数 で増える（水・食事・携帯トイレ）。備蓄日数を出せる
 * - `DAY`: 日数だけで増える（熱源）。備蓄日数を出せる
 * - `PERSON`: 人数だけで増える（照明・電源）。**使うほど減るものではないので備蓄日数を出さない**
 */
export type DisasterRequirementScale = "PERSON_DAY" | "DAY" | "PERSON";

export interface DisasterCategoryRule {
  readonly key: DisasterCategory;
  readonly label: string;
  /** 画面に出す「この区分が何を指すか」。 */
  readonly note: string;
  /** この区分で数える役割。ここに無い役割の在庫は、この区分の候補にならない。 */
  readonly roles: readonly EmergencyRole[];
  /** 判定単位。**この単位へ換算できない在庫は数えない**（過大評価を避けるため）。 */
  readonly unit: UnitCode;
  readonly scale: DisasterRequirementScale;
  /** 1人1日（または1人・1日）あたりの必要量を持つ、基準の項目名。 */
  readonly amountKey: DisasterPlanAmountKey;
}

/** 基準のうち「1単位あたりの必要量」を持つ項目。 */
export type DisasterPlanAmountKey =
  | "waterLitersPerPersonDay"
  | "foodServingsPerPersonDay"
  | "sanitationUsesPerPersonDay"
  | "lightingUnitsPerPerson"
  | "powerUnitsPerPerson"
  | "heatSourceUsesPerDay";

export const DISASTER_CATEGORY_RULES: readonly DisasterCategoryRule[] = [
  {
    key: "FOOD",
    label: "食料",
    note: "主食・主菜",
    roles: ["STAPLE_FOOD", "SIDE_DISH"],
    unit: "SERVING",
    scale: "PERSON_DAY",
    amountKey: "foodServingsPerPersonDay",
  },
  {
    key: "WATER",
    label: "飲料",
    note: "飲料水",
    // 生活用水（UTILITY_WATER）は飲めないため、飲料の必要量には数えない。
    roles: ["DRINKING_WATER"],
    unit: "LITER",
    scale: "PERSON_DAY",
    amountKey: "waterLitersPerPersonDay",
  },
  {
    key: "SANITATION",
    label: "衛生",
    note: "携帯トイレ・清拭",
    roles: ["SANITATION"],
    unit: "USE",
    scale: "PERSON_DAY",
    amountKey: "sanitationUsesPerPersonDay",
  },
  {
    key: "LIGHTING",
    label: "照明",
    note: "ライト・ランタン",
    roles: ["LIGHTING"],
    unit: "PIECE",
    scale: "PERSON",
    amountKey: "lightingUnitsPerPerson",
  },
  {
    key: "POWER",
    label: "電源",
    note: "モバイルバッテリー・乾電池",
    roles: ["POWER"],
    unit: "PIECE",
    scale: "PERSON",
    amountKey: "powerUnitsPerPerson",
  },
  {
    key: "HEAT",
    label: "熱源",
    note: "カセットボンベ",
    roles: ["HEAT_SOURCE"],
    unit: "USE",
    scale: "DAY",
    amountKey: "heatSourceUsesPerDay",
  },
];

/** 役割から区分を引く。どの区分でも数えない役割は`null`。 */
export function categoryOfRole(role: EmergencyRole): DisasterCategory | null {
  return DISASTER_CATEGORY_RULES.find((rule) => rule.roles.includes(role))?.key ?? null;
}

export function categoryRule(key: DisasterCategory): DisasterCategoryRule {
  // DISASTER_CATEGORIESの各値には必ず定義があるので、見つからないことはない。
  return DISASTER_CATEGORY_RULES.find((rule) => rule.key === key) as DisasterCategoryRule;
}

// ---------------------------------------------------------------------------
// 家庭ごとの基準
// ---------------------------------------------------------------------------

/** 判定に使う基準。`DisasterPlanSetting`の行が無い家庭では`DEFAULT_DISASTER_PLAN`を使う。 */
export interface DisasterPlanValue {
  readonly peopleCount: number;
  readonly targetDays: number;

  readonly waterLitersPerPersonDay: Decimal;
  readonly foodServingsPerPersonDay: Decimal;
  readonly sanitationUsesPerPersonDay: Decimal;
  readonly lightingUnitsPerPerson: Decimal;
  readonly powerUnitsPerPerson: Decimal;
  readonly heatSourceUsesPerDay: Decimal;

  readonly includeChilled: boolean;
  readonly includeFrozen: boolean;
  readonly includeOpened: boolean;
  readonly requireHeatSourceForHeating: boolean;
  readonly requireWaterForRehydration: boolean;
}

/**
 * 基準の既定値。スキーマの`@default`と同じ値にしてある（片方だけ変えないこと）。
 *
 * 水3L/人日と携帯トイレ5回/人日は受入条件に挙がっている目安。冷蔵・冷凍・開封済みを
 * 数えないのが既定で、**含めるには画面で明示的にチェックする**（受入条件の
 * 「明示設定なしに例外化しない」）。
 */
export const DEFAULT_DISASTER_PLAN: DisasterPlanValue = {
  peopleCount: 2,
  targetDays: 3,
  waterLitersPerPersonDay: new Decimal(3),
  foodServingsPerPersonDay: new Decimal(3),
  sanitationUsesPerPersonDay: new Decimal(5),
  lightingUnitsPerPerson: new Decimal(1),
  powerUnitsPerPerson: new Decimal(1),
  heatSourceUsesPerDay: new Decimal(1),
  includeChilled: false,
  includeFrozen: false,
  includeOpened: false,
  requireHeatSourceForHeating: true,
  requireWaterForRehydration: true,
};

/** 入力欄で受け付ける上限。桁を打ち間違えたまま保存されることを防ぐ。 */
export const MAX_PEOPLE_COUNT = 50;
export const MAX_TARGET_DAYS = 90;
export const MAX_PER_UNIT_AMOUNT = 1000;

/** 区分1つぶんの必要量。 */
export function requiredAmount(rule: DisasterCategoryRule, plan: DisasterPlanValue): Decimal {
  const perUnit = plan[rule.amountKey];
  switch (rule.scale) {
    case "PERSON_DAY":
      return perUnit.mul(plan.peopleCount).mul(plan.targetDays);
    case "PERSON":
      return perUnit.mul(plan.peopleCount);
    case "DAY":
      return perUnit.mul(plan.targetDays);
  }
}

/**
 * 1日あたりの消費量。備蓄日数（在庫 ÷ これ）の分母になる。
 *
 * `PERSON`の区分は日数で減るものではないため`null`を返し、備蓄日数を出さない。
 * 0を返しうる場合（基準に0を入れたとき）も`null`にする（0で割ると無限になるため）。
 */
export function dailyConsumption(
  rule: DisasterCategoryRule,
  plan: DisasterPlanValue,
): Decimal | null {
  const perDay =
    rule.scale === "PERSON_DAY"
      ? plan[rule.amountKey].mul(plan.peopleCount)
      : rule.scale === "DAY"
        ? plan[rule.amountKey]
        : null;
  if (!perDay || !perDay.greaterThan(0)) return null;
  return perDay;
}

/**
 * 温度帯のうち、非常時に厳しいほうを採る。
 *
 * 常温の商品でも冷蔵庫に入っていれば停電で温まるため、**商品と保管場所の厳しいほう**で
 * 判定する（過大評価を避ける側へ倒す）。
 */
export function strictestTemperatureZone(
  productZone: TemperatureZone,
  storageZone: TemperatureZone | null,
): TemperatureZone {
  const order: Readonly<Record<TemperatureZone, number>> = { AMBIENT: 0, CHILLED: 1, FROZEN: 2 };
  if (!storageZone) return productZone;
  return order[storageZone] > order[productZone] ? storageZone : productZone;
}

/**
 * 冷蔵・冷凍をいま数えているか。画面の説明文をここから作る。
 *
 * **既定の文言を固定で出さない。** 設定で含めているのに「数えていません」と書いてあると、
 * 画面の数字と説明が食い違い、どちらが本当か分からなくなる。
 */
export function includedColdZones(plan: DisasterPlanValue): string[] {
  return [plan.includeChilled ? "冷蔵" : null, plan.includeFrozen ? "冷凍" : null].filter(
    (zone): zone is string => zone !== null,
  );
}

export function formatDisasterAmount(amount: Decimal, unit: UnitCode): string {
  return `${amount.toDecimalPlaces(3).toString()}${UNIT_DEFINITIONS[unit].label}`;
}

/** 備蓄日数の表示。小数1桁まで（0.33日を「0.3日」と読ませる）。 */
export function formatCoverageDays(days: Decimal | null): string {
  if (!days) return "—";
  return `${days.toDecimalPlaces(1, Decimal.ROUND_DOWN).toString()}日ぶん`;
}

// ---------------------------------------------------------------------------
// フォームの読み取り
// ---------------------------------------------------------------------------

function text(input: RawInput, key: string): string {
  return (input[key] ?? "").trim();
}

function normalizeDigits(raw: string | undefined | null): string {
  return (raw ?? "")
    .trim()
    .replace(/[０-９．]/g, (char) =>
      char === "．" ? "." : String.fromCharCode(char.charCodeAt(0) - 0xfee0),
    )
    .replace(/,/g, "");
}

/** 1以上の整数。人数と目標日数はどちらも0だと判定が成り立たない。 */
export function parseCount(
  raw: string | undefined | null,
  field: string,
  label: string,
  max: number,
): number {
  const normalized = normalizeDigits(raw);
  if (normalized === "") throw new InventoryInputError(field, `${label}を入力してください。`);
  if (!/^\d+$/.test(normalized)) {
    throw new InventoryInputError(field, `${label}は1以上の整数で入力してください。`);
  }
  const value = Number(normalized);
  if (value < 1) throw new InventoryInputError(field, `${label}は1以上で入力してください。`);
  if (value > max) throw new InventoryInputError(field, `${label}は${max}までです。`);
  return value;
}

/** 1人1日あたりの必要量。0（「この区分は数えない」）も許す。 */
export function parsePerUnitAmount(
  raw: string | undefined | null,
  field: string,
  label: string,
): Decimal {
  const normalized = normalizeDigits(raw);
  if (normalized === "") throw new InventoryInputError(field, `${label}を入力してください。`);
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new InventoryInputError(field, `${label}は0以上の数字で入力してください。`);
  }
  const amount = new Decimal(normalized);
  if (amount.decimalPlaces() > 3) {
    throw new InventoryInputError(field, `${label}の小数は3桁までです（例: 2.5）。`);
  }
  if (amount.greaterThan(MAX_PER_UNIT_AMOUNT)) {
    throw new InventoryInputError(field, `${label}は${MAX_PER_UNIT_AMOUNT}までです。`);
  }
  return amount;
}

/**
 * 基準のフォームを読む。
 *
 * `operations.ts`の`collect()`と同じく、最初のエラーで止めて欄ごとのメッセージにする
 * （画面が直す順番と揃える）。
 */
export function parseDisasterPlanForm(input: RawInput): ParseResult<DisasterPlanValue> {
  try {
    return {
      ok: true,
      value: {
        peopleCount: parseCount(input.peopleCount, "peopleCount", "人数", MAX_PEOPLE_COUNT),
        targetDays: parseCount(input.targetDays, "targetDays", "目標日数", MAX_TARGET_DAYS),
        waterLitersPerPersonDay: parsePerUnitAmount(
          input.waterLitersPerPersonDay,
          "waterLitersPerPersonDay",
          "飲料水",
        ),
        foodServingsPerPersonDay: parsePerUnitAmount(
          input.foodServingsPerPersonDay,
          "foodServingsPerPersonDay",
          "食事",
        ),
        sanitationUsesPerPersonDay: parsePerUnitAmount(
          input.sanitationUsesPerPersonDay,
          "sanitationUsesPerPersonDay",
          "携帯トイレ",
        ),
        lightingUnitsPerPerson: parsePerUnitAmount(
          input.lightingUnitsPerPerson,
          "lightingUnitsPerPerson",
          "照明",
        ),
        powerUnitsPerPerson: parsePerUnitAmount(
          input.powerUnitsPerPerson,
          "powerUnitsPerPerson",
          "電源",
        ),
        heatSourceUsesPerDay: parsePerUnitAmount(
          input.heatSourceUsesPerDay,
          "heatSourceUsesPerDay",
          "熱源",
        ),
        includeChilled: text(input, "includeChilled") === "on",
        includeFrozen: text(input, "includeFrozen") === "on",
        includeOpened: text(input, "includeOpened") === "on",
        requireHeatSourceForHeating: text(input, "requireHeatSourceForHeating") === "on",
        requireWaterForRehydration: text(input, "requireWaterForRehydration") === "on",
      },
    };
  } catch (error) {
    if (error instanceof InventoryInputError) {
      return { ok: false, errors: { [error.field]: error.message } };
    }
    throw error;
  }
}
