import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LedgerError,
  applyEntry,
  assertDeltaSign,
  buildReversal,
  computeLotQuantity,
  isDepleted,
  isReversed,
  verifyLotQuantity,
  type LedgerEntry,
} from "./ledger.ts";
import { Decimal, UnitConversionError, quantity, type UnitCode } from "./units.ts";

function entry(
  id: string,
  type: LedgerEntry["type"],
  delta: string,
  unit: UnitCode = "PIECE",
  reversesTransactionId: string | null = null,
): LedgerEntry {
  return { id, type, quantityDelta: new Decimal(delta), unit, reversesTransactionId };
}

describe("computeLotQuantity", () => {
  it("購入・消費・廃棄の合計が現在数量になる", () => {
    const entries = [
      entry("t1", "PURCHASE", "10"),
      entry("t2", "CONSUME", "-3"),
      entry("t3", "DISPOSE", "-1"),
    ];

    assert.equal(computeLotQuantity(entries, "PIECE").amount.toString(), "6");
  });

  it("小数の数量を誤差なく扱う", () => {
    const entries = [entry("t1", "PURCHASE", "1.5", "KILOGRAM"), entry("t2", "CONSUME", "-0.3", "KILOGRAM")];

    assert.equal(computeLotQuantity(entries, "KILOGRAM").amount.toString(), "1.2");
  });

  it("換算できる単位の履歴は揃えてから合算する", () => {
    const entries = [
      entry("t1", "PURCHASE", "2", "LITER"),
      entry("t2", "CONSUME", "-500", "MILLILITER"),
    ];

    assert.equal(computeLotQuantity(entries, "LITER").amount.toString(), "1.5");
  });

  it("換算できない単位の履歴が混ざったら黙って合算しない", () => {
    const entries = [entry("t1", "PURCHASE", "10", "PIECE"), entry("t2", "CONSUME", "-1", "PACK")];

    assert.throws(() => computeLotQuantity(entries, "PIECE"), UnitConversionError);
  });

  it("履歴が無ければ0", () => {
    assert.equal(computeLotQuantity([], "PIECE").amount.toString(), "0");
  });
});

describe("buildReversal", () => {
  it("符号を反転したREVERSAL行を作り、数量が元に戻る", () => {
    const consume = entry("t2", "CONSUME", "-3");
    const entries = [entry("t1", "PURCHASE", "10"), consume];

    const reversal = buildReversal(consume, entries);
    assert.equal(reversal.type, "REVERSAL");
    assert.equal(reversal.quantityDelta.toString(), "3");
    assert.equal(reversal.reversesTransactionId, "t2");

    const after = [...entries, entry("t3", "REVERSAL", "3", "PIECE", "t2")];
    assert.equal(computeLotQuantity(after, "PIECE").amount.toString(), "10");
  });

  it("購入の取消は在庫を減らす", () => {
    const purchase = entry("t1", "PURCHASE", "10");
    const reversal = buildReversal(purchase, [purchase]);

    assert.equal(reversal.quantityDelta.toString(), "-10");
  });

  it("同じ履歴を二重に取り消せない", () => {
    const consume = entry("t2", "CONSUME", "-3");
    const entries = [consume, entry("t3", "REVERSAL", "3", "PIECE", "t2")];

    assert.equal(isReversed(consume, entries), true);
    assert.throws(() => buildReversal(consume, entries), LedgerError);
  });

  it("取消の取消はできない", () => {
    const reversal = entry("t3", "REVERSAL", "3", "PIECE", "t2");

    assert.throws(() => buildReversal(reversal, [reversal]), LedgerError);
  });
});

describe("assertDeltaSign", () => {
  it("購入は正、消費・廃棄は負でなければならない", () => {
    assert.doesNotThrow(() => assertDeltaSign("PURCHASE", new Decimal("1")));
    assert.doesNotThrow(() => assertDeltaSign("CONSUME", new Decimal("-1")));
    assert.throws(() => assertDeltaSign("PURCHASE", new Decimal("-1")), LedgerError);
    assert.throws(() => assertDeltaSign("DISPOSE", new Decimal("1")), LedgerError);
  });

  it("訂正と取消は増減どちらでもよい", () => {
    assert.doesNotThrow(() => assertDeltaSign("ADJUST", new Decimal("2")));
    assert.doesNotThrow(() => assertDeltaSign("ADJUST", new Decimal("-2")));
    assert.doesNotThrow(() => assertDeltaSign("REVERSAL", new Decimal("3")));
  });

  it("0は記録できない", () => {
    assert.throws(() => assertDeltaSign("ADJUST", new Decimal("0")), LedgerError);
  });
});

describe("verifyLotQuantity", () => {
  const entries = [entry("t1", "PURCHASE", "10"), entry("t2", "CONSUME", "-3")];

  it("集計値が履歴と一致していれば consistent", () => {
    const result = verifyLotQuantity({ quantity: new Decimal("7"), unit: "PIECE" }, entries);

    assert.equal(result.consistent, true);
    assert.equal(result.difference.amount.toString(), "0");
  });

  it("ずれていれば差分を返す（例外は投げない）", () => {
    const result = verifyLotQuantity({ quantity: new Decimal("5"), unit: "PIECE" }, entries);

    assert.equal(result.consistent, false);
    assert.equal(result.computed.amount.toString(), "7");
    assert.equal(result.stored.amount.toString(), "5");
    assert.equal(result.difference.amount.toString(), "2");
  });
});

describe("applyEntry", () => {
  it("履歴を1件積んだあとの数量を返す", () => {
    const after = applyEntry(quantity("10", "PIECE"), {
      type: "CONSUME",
      quantityDelta: new Decimal("-4"),
      unit: "PIECE",
    });

    assert.equal(after.amount.toString(), "6");
  });

  it("符号が種別と矛盾する履歴は積めない", () => {
    assert.throws(
      () =>
        applyEntry(quantity("10", "PIECE"), {
          type: "CONSUME",
          quantityDelta: new Decimal("4"),
          unit: "PIECE",
        }),
      LedgerError,
    );
  });

  it("使い切ると isDepleted になる", () => {
    const after = applyEntry(quantity("2", "PIECE"), {
      type: "CONSUME",
      quantityDelta: new Decimal("-2"),
      unit: "PIECE",
    });

    assert.equal(isDepleted(after), true);
  });
});
