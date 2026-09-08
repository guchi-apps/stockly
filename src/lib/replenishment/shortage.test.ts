import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Decimal, type UnitCode } from "../inventory/units.ts";
import {
  calculateShortage,
  calculateShortages,
  compareByShortage,
  describeRule,
  type ReplenishmentRuleSnapshot,
  type StockSnapshot,
} from "./shortage.ts";

function rule(
  overrides: Partial<ReplenishmentRuleSnapshot> & { unit?: UnitCode } = {},
): ReplenishmentRuleSnapshot {
  return {
    ruleId: "rule-1",
    target: { kind: "PRODUCT", id: "product-1", name: "トイレットペーパー" },
    thresholdAmount: new Decimal(2),
    targetAmount: new Decimal(12),
    unit: "ROLL",
    ...overrides,
  };
}

function lot(amount: string, unit: UnitCode, expired = false): StockSnapshot {
  return { amount: new Decimal(amount), unit, expired };
}

/** 1単位あたりの内容量・食数が分かっている在庫（例: 1本 = 2000mL、1パック = 1食）。 */
function lotWithContent(
  amount: string,
  unit: UnitCode,
  ...perUnit: { amount: string; unit: UnitCode }[]
): StockSnapshot {
  return {
    amount: new Decimal(amount),
    unit,
    expired: false,
    perUnitEquivalents: perUnit.map((value) => ({
      amount: new Decimal(value.amount),
      unit: value.unit,
    })),
  };
}

describe("calculateShortage", () => {
  it("基準を下回っていれば、目標までの不足量を出す", () => {
    const result = calculateShortage(rule(), [lot("0.4", "ROLL")]);

    assert.equal(result.isShort, true);
    assert.equal(result.currentAmount.toString(), "0.4");
    assert.equal(result.shortageAmount.toString(), "11.6");
  });

  it("基準ちょうどでも候補にする（「2個以下になったら」の境界を含める）", () => {
    const result = calculateShortage(rule(), [lot("2", "ROLL")]);

    assert.equal(result.isShort, true);
    assert.equal(result.shortageAmount.toString(), "10");
  });

  it("基準を上回っていれば候補にしない", () => {
    const result = calculateShortage(rule(), [lot("3", "ROLL")]);

    assert.equal(result.isShort, false);
    // 足りていても「あと何本で目標か」は出す（画面で基準の妥当性を見るため）。
    assert.equal(result.shortageAmount.toString(), "9");
  });

  it("目標を満たしていれば不足は0", () => {
    const result = calculateShortage(rule(), [lot("12", "ROLL")]);

    assert.equal(result.isShort, false);
    assert.equal(result.shortageAmount.toString(), "0");
  });

  it("同じ次元の単位は換算して合計する（L換算のmL）", () => {
    const result = calculateShortage(
      rule({ unit: "LITER", thresholdAmount: new Decimal(20), targetAmount: new Decimal(36) }),
      [lot("2", "LITER"), lot("8000", "MILLILITER")],
    );

    assert.equal(result.currentAmount.toString(), "10");
    assert.equal(result.shortageAmount.toString(), "26");
    assert.equal(result.isShort, true);
  });

  it("換算できない単位の在庫は数えず、件数だけを残す", () => {
    // 個とパックは商品ごとの入数が分からないと換算できない（units.ts）。
    const result = calculateShortage(
      rule({ unit: "PIECE", thresholdAmount: new Decimal(3), targetAmount: new Decimal(6) }),
      [lot("2", "PIECE"), lot("5", "PACK")],
    );

    assert.equal(result.currentAmount.toString(), "2");
    assert.equal(result.unconvertibleLotCount, 1);
    assert.equal(result.isShort, true);
  });

  it("内容量が分かっていれば、単位の次元をまたいで数える（2Lボトル×5本 = 10L）", () => {
    const result = calculateShortage(
      rule({ unit: "LITER", thresholdAmount: new Decimal(20), targetAmount: new Decimal(36) }),
      [lotWithContent("5", "BOTTLE", { amount: "2000", unit: "MILLILITER" })],
    );

    assert.equal(result.currentAmount.toString(), "10");
    assert.equal(result.unconvertibleLotCount, 0);
    assert.equal(result.shortageAmount.toString(), "26");
  });

  it("内容量があっても、判定単位へ換算できなければ数えない（個の基準に2Lボトル）", () => {
    const result = calculateShortage(
      rule({ unit: "PIECE", thresholdAmount: new Decimal(3), targetAmount: new Decimal(6) }),
      [lotWithContent("5", "BOTTLE", { amount: "2000", unit: "MILLILITER" })],
    );

    assert.equal(result.currentAmount.toString(), "0");
    assert.equal(result.unconvertibleLotCount, 1);
  });

  it("食数が分かっていれば、食の基準でパックの在庫を数える（1パック = 1食）", () => {
    const result = calculateShortage(
      rule({ unit: "SERVING", thresholdAmount: new Decimal(6), targetAmount: new Decimal(12) }),
      [lotWithContent("4", "PACK", { amount: "1", unit: "SERVING" })],
    );

    assert.equal(result.currentAmount.toString(), "4");
    assert.equal(result.unconvertibleLotCount, 0);
    assert.equal(result.shortageAmount.toString(), "8");
  });

  it("期限切れの在庫は数えない", () => {
    const result = calculateShortage(
      rule({ unit: "PACK", thresholdAmount: new Decimal(1), targetAmount: new Decimal(4) }),
      [lot("4", "PACK", true)],
    );

    assert.equal(result.currentAmount.toString(), "0");
    assert.equal(result.expiredLotCount, 1);
    assert.equal(result.isShort, true);
    assert.equal(result.shortageAmount.toString(), "4");
  });

  it("在庫が無ければ現在数量は0で、目標ぶんが不足になる", () => {
    const result = calculateShortage(rule({ thresholdAmount: new Decimal(0) }), []);

    assert.equal(result.currentAmount.toString(), "0");
    assert.equal(result.shortageAmount.toString(), "12");
    assert.equal(result.isShort, true);
  });

  it("取消で負になった在庫も、そのまま合計へ入れる", () => {
    const result = calculateShortage(rule(), [lot("3", "ROLL"), lot("-1", "ROLL")]);

    assert.equal(result.currentAmount.toString(), "2");
    assert.equal(result.isShort, true);
  });

  it("小数は3桁までで扱う（0.1+0.2の誤差を持ち込まない）", () => {
    const result = calculateShortage(rule({ targetAmount: new Decimal(1) }), [
      lot("0.1", "ROLL"),
      lot("0.2", "ROLL"),
    ]);

    assert.equal(result.currentAmount.toString(), "0.3");
    assert.equal(result.shortageAmount.toString(), "0.7");
  });
});

describe("calculateShortages", () => {
  it("在庫が割り当てられていない基準も、在庫0として判定する", () => {
    const rules = [rule(), rule({ ruleId: "rule-2" })];
    const results = calculateShortages(rules, new Map([["rule-1", [lot("12", "ROLL")]]]));

    assert.equal(results.length, 2);
    assert.equal(results[0].isShort, false);
    assert.equal(results[1].isShort, true);
  });
});

describe("compareByShortage", () => {
  it("不足が大きい順に並べる", () => {
    const many = calculateShortage(rule(), [lot("0", "ROLL")]);
    const few = calculateShortage(rule({ ruleId: "rule-2" }), [lot("10", "ROLL")]);

    assert.deepEqual([few, many].sort(compareByShortage)[0].ruleId, "rule-1");
  });
});

describe("describeRule", () => {
  it("基準を読める文にする", () => {
    assert.equal(
      describeRule({
        thresholdAmount: new Decimal(2),
        targetAmount: new Decimal(12),
        unit: "ROLL",
      }),
      "2ロール以下になったら12ロールまで",
    );
  });
});
