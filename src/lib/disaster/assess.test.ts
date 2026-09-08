import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveExpiry } from "../inventory/operations.ts";
import { Decimal, type Quantity, type UnitCode } from "../inventory/units.ts";

import {
  assessDisasterStock,
  groupExclusions,
  type DisasterLotSnapshot,
} from "./assess.ts";
import {
  DEFAULT_DISASTER_PLAN,
  DISASTER_CATEGORIES,
  DISASTER_CATEGORY_RULES,
  DISASTER_RULE_VERSION,
  categoryOfRole,
  parseDisasterPlanForm,
  strictestTemperatureZone,
  type DisasterCategory,
  type DisasterPlanValue,
  type EmergencyRole,
  type TemperatureZone,
} from "./rules.ts";

/**
 * `prisma/fixtures/daily-inventory.ts`の在庫を、そのまま判定へ渡せる形にしたもの。
 * 受入条件（期限切れのサトウのごはんを算入しない・未開封水10Lは算入する・飲みかけは除外）は
 * この組み合わせで確かめる。
 */
const TODAY = new Date("2026-09-08T03:00:00Z"); // JSTで9月8日12時。

function daysFromToday(days: number): Date {
  return new Date(Date.UTC(2026, 8, 8 + days));
}

interface LotInput {
  name: string;
  amount: string;
  unit: UnitCode;
  role: EmergencyRole;
  productZone?: TemperatureZone;
  storageZone?: TemperatureZone | null;
  requiresHeating?: boolean;
  requiresWater?: boolean;
  opened?: boolean;
  /** 今日からの日数。省略すると期限が入っていない扱い（要確認）。 */
  bestBeforeDays?: number;
  noExpiry?: boolean;
  perUnitEquivalents?: Quantity[];
}

function lot(input: LotInput): DisasterLotSnapshot {
  return {
    lotId: `lot-${input.name}`,
    productName: input.name,
    amount: new Decimal(input.amount),
    unit: input.unit,
    role: input.role,
    productZone: input.productZone ?? "AMBIENT",
    storageZone: input.storageZone ?? null,
    requiresHeating: input.requiresHeating ?? false,
    requiresWater: input.requiresWater ?? false,
    opened: input.opened ?? false,
    expiry: resolveExpiry(
      {
        bestBeforeDate:
          input.bestBeforeDays === undefined ? null : daysFromToday(input.bestBeforeDays),
        noExpiry: input.noExpiry ?? false,
      },
      TODAY,
    ),
    perUnitEquivalents: input.perUnitEquivalents ?? [],
  };
}

const WATER_SEALED = lot({
  name: "天然水 2L（未開封5本）",
  amount: "5",
  unit: "BOTTLE",
  role: "DRINKING_WATER",
  bestBeforeDays: 540,
  perUnitEquivalents: [{ amount: new Decimal(2000), unit: "MILLILITER" }],
});

const WATER_OPENED = lot({
  name: "天然水 2L（飲みかけ）",
  amount: "1",
  unit: "BOTTLE",
  role: "DRINKING_WATER",
  bestBeforeDays: 540,
  opened: true,
  perUnitEquivalents: [{ amount: new Decimal(2000), unit: "MILLILITER" }],
});

const PACKED_RICE_EXPIRED = lot({
  name: "サトウのごはん 200g",
  amount: "4",
  unit: "PACK",
  role: "STAPLE_FOOD",
  bestBeforeDays: -18,
  requiresHeating: true,
  perUnitEquivalents: [{ amount: new Decimal(1), unit: "SERVING" }],
});

const CUP_NOODLE = lot({
  name: "カップ麺 しょうゆ",
  amount: "2",
  unit: "PIECE",
  role: "STAPLE_FOOD",
  bestBeforeDays: 5,
  requiresHeating: true,
  requiresWater: true,
  perUnitEquivalents: [{ amount: new Decimal(1), unit: "SERVING" }],
});

const GAS_CANISTER = lot({
  name: "カセットボンベ",
  amount: "3",
  unit: "BOTTLE",
  role: "HEAT_SOURCE",
  bestBeforeDays: 365 * 5,
  perUnitEquivalents: [{ amount: new Decimal(1), unit: "USE" }],
});

const PORTABLE_TOILET = lot({
  name: "携帯トイレ",
  amount: "3",
  unit: "USE",
  role: "SANITATION",
  bestBeforeDays: 365 * 3,
});

const TOILET_PAPER = lot({
  name: "トイレットペーパー",
  amount: "0.4",
  unit: "ROLL",
  role: "SANITATION",
  noExpiry: true,
});

const WET_TISSUE = lot({
  name: "ウェットティッシュ",
  amount: "1",
  unit: "PIECE",
  role: "SANITATION",
  // 期限を入れていない＝要確認。
});

const MILK_CHILLED = lot({
  name: "牛乳 1L",
  amount: "1",
  unit: "BOTTLE",
  role: "SIDE_DISH",
  productZone: "CHILLED",
  storageZone: "CHILLED",
  bestBeforeDays: 4,
  perUnitEquivalents: [{ amount: new Decimal(2), unit: "SERVING" }],
});

const FLASHLIGHT = lot({
  name: "小型ライト",
  amount: "1",
  unit: "PIECE",
  role: "LIGHTING",
  noExpiry: true,
});

const POWER_BANK = lot({
  name: "モバイルバッテリー",
  amount: "1",
  unit: "PIECE",
  role: "POWER",
  noExpiry: true,
});

const DUCT_TAPE = lot({
  name: "ガムテープ",
  amount: "1",
  unit: "PIECE",
  role: "OTHER",
  noExpiry: true,
});

const FIXTURE_LOTS: DisasterLotSnapshot[] = [
  WATER_SEALED,
  WATER_OPENED,
  PACKED_RICE_EXPIRED,
  CUP_NOODLE,
  GAS_CANISTER,
  PORTABLE_TOILET,
  TOILET_PAPER,
  WET_TISSUE,
  MILK_CHILLED,
  FLASHLIGHT,
  POWER_BANK,
  DUCT_TAPE,
];

function categoryOf(assessment: ReturnType<typeof assessDisasterStock>, key: DisasterCategory) {
  const found = assessment.categories.find((category) => category.rule.key === key);
  assert.ok(found, `${key}の結果がありません`);
  return found;
}

function reasonOf(assessment: ReturnType<typeof assessDisasterStock>, productName: string) {
  return assessment.excludedLots.find((verdict) => verdict.lot.productName === productName)
    ?.exclusion;
}

describe("区分の定義", () => {
  it("6区分すべてに定義があり、区分どうしで役割が重ならない", () => {
    assert.equal(DISASTER_CATEGORY_RULES.length, DISASTER_CATEGORIES.length);
    const seen = new Set<EmergencyRole>();
    for (const rule of DISASTER_CATEGORY_RULES) {
      for (const role of rule.roles) {
        assert.ok(!seen.has(role), `${role}が複数の区分に割り当てられています`);
        seen.add(role);
      }
    }
  });

  it("防災の集計に出てこない役割はnullを返す", () => {
    assert.equal(categoryOfRole("STAPLE_FOOD"), "FOOD");
    assert.equal(categoryOfRole("DRINKING_WATER"), "WATER");
    // 生活用水は飲めないので飲料には数えない。
    assert.equal(categoryOfRole("UTILITY_WATER"), null);
    assert.equal(categoryOfRole("OTHER"), null);
    assert.equal(categoryOfRole("NONE"), null);
  });
});

describe("温度帯は商品と保管場所の厳しいほうを採る", () => {
  it("常温の商品でも冷蔵庫に入っていれば冷蔵扱い", () => {
    assert.equal(strictestTemperatureZone("AMBIENT", "CHILLED"), "CHILLED");
    assert.equal(strictestTemperatureZone("CHILLED", "FROZEN"), "FROZEN");
    // 冷凍品を常温の棚に出してあっても、商品側の厳しさは消えない。
    assert.equal(strictestTemperatureZone("FROZEN", "AMBIENT"), "FROZEN");
    assert.equal(strictestTemperatureZone("AMBIENT", null), "AMBIENT");
  });
});

describe("fixtureの在庫を既定の基準（2人・3日）で判定する", () => {
  const assessment = assessDisasterStock(FIXTURE_LOTS, DEFAULT_DISASTER_PLAN);

  it("未開封の水10Lを算入し、飲みかけは除外する", () => {
    const water = categoryOf(assessment, "WATER");
    assert.equal(water.includedAmount.toString(), "10");
    assert.equal(water.requiredAmount.toString(), "18"); // 3L × 2人 × 3日
    assert.equal(water.shortageAmount.toString(), "8");
    assert.equal(reasonOf(assessment, "天然水 2L（飲みかけ）"), "OPENED");
  });

  it("期限切れのサトウのごはん4パックを算入しない", () => {
    const food = categoryOf(assessment, "FOOD");
    assert.equal(reasonOf(assessment, "サトウのごはん 200g"), "EXPIRED");
    // 算入されるのはカップ麺2食だけ（牛乳は冷蔵で除外）。
    assert.equal(food.includedAmount.toString(), "2");
    assert.equal(food.requiredAmount.toString(), "18"); // 3食 × 2人 × 3日
    assert.equal(food.shortageAmount.toString(), "16");
  });

  it("冷蔵の在庫を停電時の日数へ含めない", () => {
    assert.equal(reasonOf(assessment, "牛乳 1L"), "CHILLED");
  });

  it("判定単位へ換算できない在庫と、期限が要確認の在庫を数えない", () => {
    const sanitation = categoryOf(assessment, "SANITATION");
    assert.equal(sanitation.includedAmount.toString(), "3"); // 携帯トイレ3回だけ
    assert.equal(sanitation.requiredAmount.toString(), "30"); // 5回 × 2人 × 3日
    assert.equal(reasonOf(assessment, "トイレットペーパー"), "UNCONVERTIBLE");
    assert.equal(reasonOf(assessment, "ウェットティッシュ"), "UNKNOWN_EXPIRY");
  });

  it("どの区分にも当たらない役割の在庫は、除外にも算入にも出さない", () => {
    const names = [...assessment.excludedLots, ...assessment.categories.flatMap((c) => c.includedLots)]
      .map((verdict) => verdict.lot.productName);
    assert.ok(!names.includes("ガムテープ"));
  });

  it("照明・電源は日数で数えず、不足だけを出す", () => {
    const lighting = categoryOf(assessment, "LIGHTING");
    assert.equal(lighting.coverageDays, null);
    assert.equal(lighting.includedAmount.toString(), "1");
    assert.equal(lighting.requiredAmount.toString(), "2"); // 1個 × 2人
    assert.equal(lighting.shortageAmount.toString(), "1");
    assert.equal(categoryOf(assessment, "POWER").coverageDays, null);
  });

  it("熱源は人数では増えず、日数だけで必要量が決まる", () => {
    const heat = categoryOf(assessment, "HEAT");
    assert.equal(heat.requiredAmount.toString(), "3"); // 1回/日 × 3日
    assert.equal(heat.includedAmount.toString(), "3");
    assert.equal(heat.isMet, true);
    assert.equal(heat.coverageDays?.toString(), "3");
  });

  it("全体の備蓄日数は、日数を出せる区分のいちばん短いものになる", () => {
    // 食料 2/(3×2)=0.333、飲料 10/(3×2)=1.666、衛生 3/(5×2)=0.3、熱源 3/1=3。
    assert.equal(assessment.coverageDays?.toString(), "0.3");
    assert.equal(assessment.meetsTarget, false);
    assert.equal(assessment.ruleVersion, DISASTER_RULE_VERSION);
  });

  it("数えなかった在庫を理由ごとにまとめられる", () => {
    const groups = groupExclusions(assessment.excludedLots);
    const byReason = Object.fromEntries(groups.map((group) => [group.reason, group.lots.length]));
    assert.deepEqual(byReason, {
      EXPIRED: 1,
      UNKNOWN_EXPIRY: 1,
      CHILLED: 1,
      OPENED: 1,
      UNCONVERTIBLE: 1,
    });
  });
});

describe("加熱・水の要否", () => {
  const noHeat: DisasterLotSnapshot[] = [CUP_NOODLE, WATER_SEALED];

  it("熱源が無ければ、加熱が要る食料を数えない", () => {
    const assessment = assessDisasterStock(noHeat, DEFAULT_DISASTER_PLAN);
    assert.equal(categoryOf(assessment, "FOOD").includedAmount.toString(), "0");
    assert.equal(reasonOf(assessment, "カップ麺 しょうゆ"), "NO_HEAT_SOURCE");
  });

  it("熱源があれば数える", () => {
    const assessment = assessDisasterStock([...noHeat, GAS_CANISTER], DEFAULT_DISASTER_PLAN);
    assert.equal(categoryOf(assessment, "FOOD").includedAmount.toString(), "2");
  });

  it("水が無ければ、水が要る食料を数えない", () => {
    const assessment = assessDisasterStock([CUP_NOODLE, GAS_CANISTER], DEFAULT_DISASTER_PLAN);
    assert.equal(reasonOf(assessment, "カップ麺 しょうゆ"), "NO_WATER");
  });

  it("設定を外せば、熱源が無くても数える", () => {
    const plan: DisasterPlanValue = {
      ...DEFAULT_DISASTER_PLAN,
      requireHeatSourceForHeating: false,
      requireWaterForRehydration: false,
    };
    const assessment = assessDisasterStock([CUP_NOODLE], plan);
    assert.equal(categoryOf(assessment, "FOOD").includedAmount.toString(), "2");
  });
});

describe("明示設定なしに例外化しない", () => {
  it("冷蔵を含める設定を立てたときだけ、冷蔵の在庫を数える", () => {
    const excluded = assessDisasterStock([MILK_CHILLED], DEFAULT_DISASTER_PLAN);
    assert.equal(categoryOf(excluded, "FOOD").includedAmount.toString(), "0");

    const included = assessDisasterStock([MILK_CHILLED], {
      ...DEFAULT_DISASTER_PLAN,
      includeChilled: true,
    });
    assert.equal(categoryOf(included, "FOOD").includedAmount.toString(), "2"); // 1本 = 2食
  });

  it("期限切れは、どの設定を立てても数えない", () => {
    const plan: DisasterPlanValue = {
      ...DEFAULT_DISASTER_PLAN,
      includeChilled: true,
      includeFrozen: true,
      includeOpened: true,
      requireHeatSourceForHeating: false,
      requireWaterForRehydration: false,
    };
    const assessment = assessDisasterStock([PACKED_RICE_EXPIRED], plan);
    assert.equal(categoryOf(assessment, "FOOD").includedAmount.toString(), "0");
    assert.equal(reasonOf(assessment, "サトウのごはん 200g"), "EXPIRED");
  });
});

describe("判定は決定的", () => {
  it("同じ在庫と基準なら、同じ数字になる", () => {
    const a = assessDisasterStock(FIXTURE_LOTS, DEFAULT_DISASTER_PLAN);
    const b = assessDisasterStock([...FIXTURE_LOTS].reverse(), DEFAULT_DISASTER_PLAN);
    assert.equal(a.coverageDays?.toString(), b.coverageDays?.toString());
    for (const key of DISASTER_CATEGORIES) {
      assert.equal(
        categoryOf(a, key).includedAmount.toString(),
        categoryOf(b, key).includedAmount.toString(),
      );
    }
  });

  it("在庫が無ければ備蓄日数は0で、必要量がそのまま不足になる", () => {
    const assessment = assessDisasterStock([], DEFAULT_DISASTER_PLAN);
    assert.equal(assessment.coverageDays?.toString(), "0");
    assert.equal(categoryOf(assessment, "WATER").shortageAmount.toString(), "18");
    assert.equal(assessment.meetsTarget, false);
  });

  it("必要量を0にした区分は備蓄日数を出さない（0で割らない）", () => {
    const plan: DisasterPlanValue = {
      ...DEFAULT_DISASTER_PLAN,
      waterLitersPerPersonDay: new Decimal(0),
    };
    const assessment = assessDisasterStock([WATER_SEALED], plan);
    const water = categoryOf(assessment, "WATER");
    assert.equal(water.coverageDays, null);
    assert.equal(water.isMet, true);
  });
});

describe("基準のフォームを読む", () => {
  const valid = {
    peopleCount: "4",
    targetDays: "7",
    waterLitersPerPersonDay: "3",
    foodServingsPerPersonDay: "3",
    sanitationUsesPerPersonDay: "5",
    lightingUnitsPerPerson: "1",
    powerUnitsPerPerson: "1",
    heatSourceUsesPerDay: "1",
  };

  it("全角数字を受け付け、チェックの無い項目はfalseになる", () => {
    const parsed = parseDisasterPlanForm({ ...valid, peopleCount: "４" });
    assert.ok(parsed.ok);
    assert.equal(parsed.value.peopleCount, 4);
    assert.equal(parsed.value.includeChilled, false);
    assert.equal(parsed.value.requireHeatSourceForHeating, false);
  });

  it("チェックが入っていればtrueになる", () => {
    const parsed = parseDisasterPlanForm({ ...valid, includeChilled: "on" });
    assert.ok(parsed.ok);
    assert.equal(parsed.value.includeChilled, true);
  });

  it("人数と目標日数に0は入れられない", () => {
    const parsed = parseDisasterPlanForm({ ...valid, peopleCount: "0" });
    assert.equal(parsed.ok, false);
    assert.ok(!parsed.ok && parsed.errors.peopleCount);
  });

  it("必要量は0を許す（その区分を数えない、の意味）", () => {
    const parsed = parseDisasterPlanForm({ ...valid, heatSourceUsesPerDay: "0" });
    assert.ok(parsed.ok);
    assert.equal(parsed.value.heatSourceUsesPerDay.toString(), "0");
  });

  it("数字でない値と、桁が大きすぎる値を弾く", () => {
    assert.equal(parseDisasterPlanForm({ ...valid, targetDays: "いっぱい" }).ok, false);
    assert.equal(parseDisasterPlanForm({ ...valid, targetDays: "9999" }).ok, false);
    assert.equal(parseDisasterPlanForm({ ...valid, waterLitersPerPersonDay: "-1" }).ok, false);
  });
});
