import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  Decimal,
  UNIT_DEFINITIONS,
  UnitConversionError,
  canConvert,
  compareQuantities,
  convertQuantity,
  formatQuantity,
  groupSummableQuantities,
  quantity,
  subtractQuantities,
  sumQuantities,
} from "./units.ts";

describe("単位の定義", () => {
  it("基準単位を持つ単位は、自分の基準単位と同じ次元である", () => {
    for (const [code, definition] of Object.entries(UNIT_DEFINITIONS)) {
      assert.equal(
        UNIT_DEFINITIONS[definition.base].dimension,
        definition.dimension,
        `${code} の基準単位の次元が一致していません`,
      );
    }
  });
});

describe("canConvert", () => {
  it("同じ単位は常に換算できる", () => {
    assert.equal(canConvert("PIECE", "PIECE"), true);
  });

  it("同じ次元で基準単位を共有する単位どうしは換算できる", () => {
    assert.equal(canConvert("LITER", "MILLILITER"), true);
    assert.equal(canConvert("KILOGRAM", "GRAM"), true);
  });

  it("次元が違えば換算できない", () => {
    assert.equal(canConvert("MILLILITER", "GRAM"), false);
    assert.equal(canConvert("SERVING", "USE"), false);
  });

  it("個数系どうしは、同じ次元でも換算できない（入数が商品ごとに違うため）", () => {
    assert.equal(canConvert("PIECE", "PACK"), false);
    assert.equal(canConvert("BOTTLE", "CAN"), false);
  });
});

describe("convertQuantity", () => {
  it("L から mL へ換算する", () => {
    const converted = convertQuantity(quantity("1.5", "LITER"), "MILLILITER");
    assert.equal(converted.amount.toString(), "1500");
    assert.equal(converted.unit, "MILLILITER");
  });

  it("mL から L へ換算する", () => {
    const converted = convertQuantity(quantity("250", "MILLILITER"), "LITER");
    assert.equal(converted.amount.toString(), "0.25");
  });

  it("換算できない単位は UnitConversionError を投げる", () => {
    assert.throws(
      () => convertQuantity(quantity("1", "PIECE"), "PACK"),
      (error: unknown) => error instanceof UnitConversionError,
    );
  });
});

describe("sumQuantities", () => {
  it("小数を誤差なく合算する", () => {
    const total = sumQuantities([quantity("0.1", "KILOGRAM"), quantity("0.2", "KILOGRAM")]);
    assert.equal(total.amount.toString(), "0.3");
  });

  it("換算できる単位は揃えてから合算する", () => {
    const total = sumQuantities([quantity("1", "LITER"), quantity("500", "MILLILITER")], "LITER");
    assert.equal(total.amount.toString(), "1.5");
    assert.equal(total.unit, "LITER");
  });

  it("換算できない単位が混ざったら、黙って合算せず例外を投げる", () => {
    assert.throws(
      () => sumQuantities([quantity("3", "PIECE"), quantity("2", "PACK")]),
      UnitConversionError,
    );
    assert.throws(
      () => sumQuantities([quantity("3", "SERVING"), quantity("2", "USE")]),
      UnitConversionError,
    );
  });

  it("空配列は targetUnit があれば0、なければ例外", () => {
    assert.equal(sumQuantities([], "PIECE").amount.toString(), "0");
    assert.throws(() => sumQuantities([]), /targetUnit/);
  });
});

describe("subtractQuantities / compareQuantities", () => {
  it("換算してから引き算する", () => {
    const rest = subtractQuantities(quantity("2", "LITER"), quantity("300", "MILLILITER"));
    assert.equal(rest.amount.toString(), "1.7");
  });

  it("単位が違っても同じ量なら等しいと判定する", () => {
    assert.equal(
      compareQuantities(quantity("1", "KILOGRAM"), quantity("1000", "GRAM")),
      0,
    );
  });
});

describe("groupSummableQuantities", () => {
  it("合算できるものだけまとめ、できないものは残す", () => {
    const groups = groupSummableQuantities([
      quantity("1", "LITER"),
      quantity("500", "MILLILITER"),
      quantity("3", "PIECE"),
      quantity("2", "PACK"),
    ]);

    assert.deepEqual(
      groups.map((group) => [group.amount.toString(), group.unit]),
      [
        ["1.5", "LITER"],
        ["3", "PIECE"],
        ["2", "PACK"],
      ],
    );
  });
});

describe("formatQuantity", () => {
  it("末尾の余分な0を落として単位記号を付ける", () => {
    assert.equal(formatQuantity({ amount: new Decimal("1.500"), unit: "LITER" }), "1.5L");
    assert.equal(formatQuantity(quantity("3", "PIECE")), "3個");
  });
});
