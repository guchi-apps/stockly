import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveExpiry } from "../inventory/operations.ts";
import { Decimal, type Quantity, type UnitCode } from "../inventory/units.ts";

import { assessDisasterStock, type DisasterLotSnapshot } from "./assess.ts";
import {
  attentionOf,
  countForInspection,
  needsInspection,
  nextInspectionDueOn,
  parseBagInspectionForm,
  parseDisasterBagPlanForm,
  resolveInspectionState,
  summarizeAttention,
  toBagPlan,
  BAG_ATTENTION_KINDS,
  DEFAULT_DISASTER_BAG_PLAN,
  type BagItem,
} from "./bag.ts";
import { DEFAULT_DISASTER_PLAN, categoryRule } from "./rules.ts";

/** JSTで2026年9月8日の昼。日付の境目がずれないよう、UTCの3時に置いてある。 */
const TODAY = new Date("2026-09-08T03:00:00Z");

function dateFromToday(days: number): Date {
  return new Date(Date.UTC(2026, 8, 8 + days));
}

// ---------------------------------------------------------------------------
// バッグの目標の重ね方
// ---------------------------------------------------------------------------

describe("toBagPlan", () => {
  it("人数と目標日数だけをバッグのもので置き換える", () => {
    const merged = toBagPlan(DEFAULT_DISASTER_PLAN, {
      peopleCount: 1,
      targetDays: 1,
      inspectionIntervalDays: 180,
    });

    assert.equal(merged.peopleCount, 1);
    assert.equal(merged.targetDays, 1);
    // 1人1日あたりの量と「何を数えるか」は家庭の基準のまま。
    assert.equal(merged.waterLitersPerPersonDay.toString(), "3");
    assert.equal(merged.includeChilled, false);
    assert.equal(merged.requireHeatSourceForHeating, true);
  });

  it("既定は1人・1日ぶん（家庭全体の2人・3日とは別に持つ）", () => {
    assert.equal(DEFAULT_DISASTER_BAG_PLAN.peopleCount, 1);
    assert.equal(DEFAULT_DISASTER_BAG_PLAN.targetDays, 1);
    assert.notEqual(DEFAULT_DISASTER_BAG_PLAN.targetDays, DEFAULT_DISASTER_PLAN.targetDays);
  });
});

// ---------------------------------------------------------------------------
// 手当てが要るもの
// ---------------------------------------------------------------------------

interface ItemInput {
  name: string;
  hasQuantity?: boolean;
  opened?: boolean;
  /** 今日からの日数。省略すると期限が入っていない扱い（要確認）。 */
  bestBeforeDays?: number;
  noExpiry?: boolean;
}

function item(input: ItemInput): BagItem {
  return {
    lotId: `lot-${input.name}`,
    productName: input.name,
    hasQuantity: input.hasQuantity ?? true,
    opened: input.opened ?? false,
    expiry: resolveExpiry(
      {
        bestBeforeDate:
          input.bestBeforeDays === undefined ? null : dateFromToday(input.bestBeforeDays),
        noExpiry: input.noExpiry ?? false,
      },
      TODAY,
    ),
  };
}

describe("attentionOf", () => {
  it("期限内で未開封・残量ありなら手当ては要らない", () => {
    assert.equal(attentionOf(item({ name: "携帯トイレ", bestBeforeDays: 900 })), null);
    assert.equal(attentionOf(item({ name: "小型ライト", noExpiry: true })), null);
  });

  it("期限切れ・期限間近・期限が未入力をそれぞれ別に数える", () => {
    assert.equal(attentionOf(item({ name: "保存食", bestBeforeDays: -1 })), "EXPIRED");
    assert.equal(attentionOf(item({ name: "保存食", bestBeforeDays: 3 })), "EXPIRING_SOON");
    // 期限が空 = 要確認。「期限なし」と決めたもの（noExpiry）とは区別する。
    assert.equal(attentionOf(item({ name: "ウェットティッシュ" })), "UNKNOWN_EXPIRY");
    assert.equal(attentionOf(item({ name: "ガムテープ", noExpiry: true })), null);
  });

  it("1件につき理由は1つだけ返す（合計が中身の件数を超えないため）", () => {
    const both = item({ name: "飲みかけの水", bestBeforeDays: -3, opened: true });
    assert.equal(attentionOf(both), "EXPIRED");
  });

  it("残量が無いものは期限より先に拾う", () => {
    assert.equal(
      attentionOf(item({ name: "使い切り", hasQuantity: false, bestBeforeDays: -1 })),
      "NOT_POSITIVE",
    );
  });
});

describe("summarizeAttention", () => {
  const items = [
    item({ name: "携帯トイレ", bestBeforeDays: 900 }),
    item({ name: "ウェットティッシュ" }),
    item({ name: "トイレットペーパー", opened: true, noExpiry: true }),
  ];

  it("0件の観点も落とさずに返す（見ていないのか0件なのかを読み分けるため）", () => {
    const groups = summarizeAttention(items);
    assert.equal(groups.length, BAG_ATTENTION_KINDS.length);
    assert.deepEqual(
      groups.map((group) => [group.kind, group.items.length]),
      [
        ["EXPIRED", 0],
        ["EXPIRING_SOON", 0],
        ["UNKNOWN_EXPIRY", 1],
        ["OPENED", 1],
        ["NOT_POSITIVE", 0],
      ],
    );
  });

  it("記録に残す件数は中身の件数を超えない", () => {
    const counts = countForInspection(items);
    assert.equal(counts.itemCount, 3);
    assert.equal(counts.expiredCount, 0);
    assert.equal(counts.expiringSoonCount, 0);
    assert.equal(counts.unknownExpiryCount, 1);
  });
});

// ---------------------------------------------------------------------------
// 次回の点検予定
// ---------------------------------------------------------------------------

describe("resolveInspectionState", () => {
  it("一度も点検していない状態は期限切れと分ける", () => {
    const state = resolveInspectionState(null, 180, dateFromToday(0));
    assert.equal(state.status, "NEVER");
    assert.equal(state.dueOn, null);
    assert.equal(needsInspection(state), true);
  });

  it("最後の点検日に間隔を足した日が予定日になる", () => {
    const due = nextInspectionDueOn(dateFromToday(-180), 180);
    assert.equal(due?.toISOString(), dateFromToday(0).toISOString());
  });

  it("予定日を過ぎていればOVERDUE、14日以内ならDUE_SOON", () => {
    const overdue = resolveInspectionState(dateFromToday(-181), 180, dateFromToday(0));
    assert.equal(overdue.status, "OVERDUE");
    assert.equal(overdue.daysLeft, -1);
    assert.equal(needsInspection(overdue), true);

    const soon = resolveInspectionState(dateFromToday(-170), 180, dateFromToday(0));
    assert.equal(soon.status, "DUE_SOON");
    assert.equal(soon.daysLeft, 10);
    assert.equal(needsInspection(soon), false);

    const ok = resolveInspectionState(dateFromToday(-10), 180, dateFromToday(0));
    assert.equal(ok.status, "OK");
    assert.equal(needsInspection(ok), false);
  });

  it("予定日ちょうどの日はまだ期限切れにしない", () => {
    const state = resolveInspectionState(dateFromToday(-180), 180, dateFromToday(0));
    assert.equal(state.status, "DUE_SOON");
    assert.equal(state.daysLeft, 0);
  });
});

// ---------------------------------------------------------------------------
// フォームの読み取り
// ---------------------------------------------------------------------------

describe("parseDisasterBagPlanForm", () => {
  it("全角の数字を受け付ける", () => {
    const parsed = parseDisasterBagPlanForm({
      peopleCount: "２",
      targetDays: "3",
      inspectionIntervalDays: "90",
    });
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.ok && parsed.value, {
      peopleCount: 2,
      targetDays: 3,
      inspectionIntervalDays: 90,
    });
  });

  it("0や空欄は欄ごとのメッセージで返す", () => {
    const zero = parseDisasterBagPlanForm({
      peopleCount: "0",
      targetDays: "1",
      inspectionIntervalDays: "180",
    });
    assert.equal(zero.ok, false);
    assert.ok(!zero.ok && zero.errors.peopleCount);

    const empty = parseDisasterBagPlanForm({ peopleCount: "1", targetDays: "" });
    assert.equal(empty.ok, false);
    assert.ok(!empty.ok && empty.errors.targetDays);
  });
});

describe("parseBagInspectionForm", () => {
  it("点検日とメモを読む", () => {
    const parsed = parseBagInspectionForm(
      { inspectedOn: "2026-09-08", note: "  携帯トイレを補充  " },
      TODAY,
    );
    assert.equal(parsed.ok, true);
    assert.equal(parsed.ok && parsed.value.note, "携帯トイレを補充");
    assert.equal(parsed.ok && parsed.value.inspectedOn.toISOString(), "2026-09-08T00:00:00.000Z");
  });

  it("未来の日付は受け付けない（見ていない日を記録させないため）", () => {
    const parsed = parseBagInspectionForm({ inspectedOn: "2026-09-09" }, TODAY);
    assert.equal(parsed.ok, false);
    assert.ok(!parsed.ok && parsed.errors.inspectedOn);
  });

  it("今日は受け付ける（JSTの昼に「今日」を入れて弾かれない）", () => {
    const parsed = parseBagInspectionForm({ inspectedOn: "2026-09-08" }, TODAY);
    assert.equal(parsed.ok, true);
  });

  it("空のメモはnullにする", () => {
    const parsed = parseBagInspectionForm({ inspectedOn: "2026-09-08", note: "   " }, TODAY);
    assert.equal(parsed.ok && parsed.value.note, null);
  });
});

// ---------------------------------------------------------------------------
// 初期データ（prisma/fixtures/daily-inventory.ts）が期待どおり出るか
// ---------------------------------------------------------------------------

interface LotInput {
  name: string;
  amount: string;
  unit: UnitCode;
  role: DisasterLotSnapshot["role"];
  opened?: boolean;
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
    productZone: "AMBIENT",
    storageZone: "AMBIENT",
    requiresHeating: false,
    requiresWater: false,
    opened: input.opened ?? false,
    expiry: resolveExpiry(
      {
        bestBeforeDate:
          input.bestBeforeDays === undefined ? null : dateFromToday(input.bestBeforeDays),
        noExpiry: input.noExpiry ?? false,
      },
      TODAY,
    ),
    perUnitEquivalents: input.perUnitEquivalents ?? [],
  };
}

/** 保管場所「防災バッグ」に入っている初期データ。 */
const BAG_LOTS: DisasterLotSnapshot[] = [
  // 携帯トイレ 3回ぶん（usesPerUnit = 1 の「回」）。
  lot({ name: "携帯トイレ", amount: "3", unit: "USE", role: "SANITATION", bestBeforeDays: 900 }),
  // ゴミ袋 3枚。衛生の役割は持つが「回」へ換算できない。
  lot({ name: "ゴミ袋 45L", amount: "3", unit: "PIECE", role: "SANITATION", noExpiry: true }),
  lot({ name: "ウェットティッシュ", amount: "1", unit: "PIECE", role: "SANITATION" }),
  lot({
    name: "トイレットペーパー",
    amount: "0.4",
    unit: "ROLL",
    role: "SANITATION",
    noExpiry: true,
    opened: true,
  }),
  lot({ name: "小型ライト", amount: "1", unit: "PIECE", role: "LIGHTING", noExpiry: true }),
  lot({ name: "モバイルバッテリー", amount: "1", unit: "PIECE", role: "POWER", noExpiry: true }),
];

describe("初期データの防災バッグ", () => {
  const plan = toBagPlan(DEFAULT_DISASTER_PLAN, DEFAULT_DISASTER_BAG_PLAN);
  const assessment = assessDisasterStock(BAG_LOTS, plan);
  const byKey = (key: "SANITATION" | "LIGHTING" | "POWER") =>
    assessment.categories.find((category) => category.rule.key === key)!;

  it("携帯トイレ3回ぶんを衛生として数える", () => {
    const sanitation = byKey("SANITATION");
    assert.equal(sanitation.includedAmount.toString(), "3");
    assert.deepEqual(
      sanitation.includedLots.map((verdict) => verdict.lot.productName),
      ["携帯トイレ"],
    );
    // 1人1日の目標は5回なので、2回たりない。
    assert.equal(sanitation.requiredAmount.toString(), "5");
    assert.equal(sanitation.shortageAmount.toString(), "2");
    assert.equal(sanitation.isMet, false);
  });

  it("袋3枚は「換算できない」として、期限が空のものとは別の理由で外す", () => {
    const reasons = new Map(
      byKey("SANITATION").excludedLots.map((verdict) => [
        verdict.lot.productName,
        verdict.exclusion,
      ]),
    );
    assert.equal(reasons.get("ゴミ袋 45L"), "UNCONVERTIBLE");
    assert.equal(reasons.get("ウェットティッシュ"), "UNKNOWN_EXPIRY");
    assert.equal(reasons.get("トイレットペーパー"), "OPENED");
  });

  it("照明・電源は1人1個の目標に届く", () => {
    assert.equal(byKey("LIGHTING").isMet, true);
    assert.equal(byKey("POWER").isMet, true);
    // 使うほど減るものではないので、備蓄日数は出さない。
    assert.equal(byKey("LIGHTING").coverageDays, null);
  });

  it("バッグに入っていない飲料水・食料・熱源は0のまま不足として出る", () => {
    const empty = assessment.categories.filter((category) =>
      ["WATER", "FOOD", "HEAT"].includes(category.rule.key),
    );
    assert.equal(empty.length, 3);
    for (const category of empty) {
      assert.equal(category.includedAmount.toString(), "0");
      assert.equal(category.isMet, false);
    }
  });

  it("点検で手当てが要るのは、期限が空の1件と開封済みの1件", () => {
    const items = BAG_LOTS.map((snapshot) =>
      item({
        name: snapshot.productName,
        bestBeforeDays: snapshot.expiry.date ? 900 : undefined,
        noExpiry: snapshot.expiry.status === "NONE",
        opened: snapshot.opened,
      }),
    );
    const counts = countForInspection(items);
    assert.equal(counts.itemCount, 6);
    assert.equal(counts.expiredCount, 0);
    assert.equal(counts.unknownExpiryCount, 1);
  });
});

describe("家庭全体の初期データ", () => {
  /** 食品棚・冷蔵庫にあるぶん。受入条件の「水10L」はここで確かめる。 */
  const HOUSE_LOTS: DisasterLotSnapshot[] = [
    lot({
      name: "天然水 2L（未開封5本）",
      amount: "5",
      unit: "BOTTLE",
      role: "DRINKING_WATER",
      bestBeforeDays: 500,
      perUnitEquivalents: [{ amount: new Decimal(2000), unit: "MILLILITER" }],
    }),
    lot({
      name: "天然水 2L（飲みかけ1本）",
      amount: "1",
      unit: "BOTTLE",
      role: "DRINKING_WATER",
      bestBeforeDays: 500,
      opened: true,
      perUnitEquivalents: [{ amount: new Decimal(2000), unit: "MILLILITER" }],
    }),
  ];

  it("2L×5本を10Lとして数え、飲みかけの1本は数えない", () => {
    const assessment = assessDisasterStock(HOUSE_LOTS, DEFAULT_DISASTER_PLAN);
    const water = assessment.categories.find((category) => category.rule.key === "WATER")!;

    assert.equal(categoryRule("WATER").unit, "LITER");
    assert.equal(water.includedAmount.toString(), "10");
    assert.equal(water.excludedLots[0]?.exclusion, "OPENED");
    // 2人・3日で18Lが目標なので8Lたりない。
    assert.equal(water.shortageAmount.toString(), "8");
  });
});
