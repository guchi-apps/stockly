import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ExtractionFormatError,
  INTAKE_ITEM_LIMIT,
  parseExtraction,
  readAmount,
  readConfidence,
  readDate,
} from "./extraction.ts";

/** 検証を通る最小の1件。個々のテストで必要な欄だけ上書きする。 */
function item(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    imageIndex: 0,
    ignore: false,
    productName: "サッポロ一番 塩らーめん",
    brand: null,
    categoryName: "麺類",
    amount: "1",
    unit: "PACK",
    expiryKind: "UNKNOWN",
    expiryDate: null,
    storageName: null,
    evidence: "レシート3行目",
    confidence: 0.9,
    fieldConfidence: { productName: 0.9, amount: 0.8, expiry: null, category: 0.7, storage: null },
    ...overrides,
  };
}

describe("readAmount", () => {
  it("十進の文字列として読める値だけを採る", () => {
    assert.equal(readAmount("2"), "2");
    assert.equal(readAmount(3), "3");
    assert.equal(readAmount("1.5"), "1.5");
  });

  it("全角数字と桁区切りのカンマを正規化する", () => {
    assert.equal(readAmount("１２"), "12");
    assert.equal(readAmount("1,200"), "1200");
    assert.equal(readAmount("１．５"), "1.5");
  });

  it("0以下・小数4桁以上・数でないものはnull（黙って丸めない）", () => {
    assert.equal(readAmount("0"), null);
    assert.equal(readAmount("-1"), null);
    assert.equal(readAmount("1.2345"), null);
    assert.equal(readAmount("2個"), null);
    assert.equal(readAmount(null), null);
  });
});

describe("readDate", () => {
  it("YYYY-MM-DDだけを受け付ける", () => {
    assert.equal(readDate("2026-09-15"), "2026-09-15");
    assert.equal(readDate("2026/09/15"), null);
    assert.equal(readDate("26.09.15"), null);
  });

  it("暦として存在しない日付を通さない（Dateの繰り上げを当てにしない）", () => {
    assert.equal(readDate("2026-02-30"), null);
    assert.equal(readDate("2026-13-01"), null);
  });

  it("明らかに読み違えた年を捨てる", () => {
    assert.equal(readDate("0026-09-15"), null);
    assert.equal(readDate("2999-09-15"), null);
  });
});

describe("readConfidence", () => {
  it("0〜1に収まる数だけを採る", () => {
    assert.equal(readConfidence(0.925), 0.925);
    assert.equal(readConfidence(0), 0);
    assert.equal(readConfidence(1), 1);
  });

  it("範囲外・数でないものはnull（百分率で来ても勝手に割らない）", () => {
    assert.equal(readConfidence(92), null);
    assert.equal(readConfidence(-0.1), null);
    assert.equal(readConfidence("0.9"), null);
    assert.equal(readConfidence(Number.NaN), null);
  });
});

describe("parseExtraction", () => {
  const options = { imageCount: 2 };

  it("応答がオブジェクトでなければ投げる", () => {
    assert.throws(() => parseExtraction("[]", options), ExtractionFormatError);
    assert.throws(() => parseExtraction(null, options), ExtractionFormatError);
  });

  it("itemsが配列でなければ投げる", () => {
    assert.throws(() => parseExtraction({ items: "1件" }, options), ExtractionFormatError);
  });

  it("読めた行を候補にする", () => {
    const [first] = parseExtraction({ items: [item()] }, options);
    assert.equal(first.productName, "サッポロ一番 塩らーめん");
    assert.equal(first.amount, "1");
    assert.equal(first.unit, "PACK");
    assert.equal(first.confidence, 0.9);
    assert.equal(first.fieldConfidence.amount, 0.8);
    assert.equal(first.fieldConfidence.expiry, null);
  });

  it("知らない欄は落とす（増えた欄がそのままDBへ入らないようにする）", () => {
    const [first] = parseExtraction({ items: [item({ price: 298, taxRate: 0.08 })] }, options);
    assert.equal("price" in first, false);
    assert.equal("taxRate" in first, false);
  });

  it("壊れた欄はnullにして、残りの欄を活かす", () => {
    const [first] = parseExtraction(
      { items: [item({ amount: "たくさん", unit: "ダース", confidence: 92 })] },
      options,
    );
    assert.equal(first.amount, null);
    assert.equal(first.unit, null);
    assert.equal(first.confidence, null);
    assert.equal(first.productName, "サッポロ一番 塩らーめん");
  });

  it("日付を持つ種別なのに日付が読めていない組み合わせを作らない", () => {
    const [first] = parseExtraction(
      { items: [item({ expiryKind: "BEST_BEFORE", expiryDate: "2026-02-30" })] },
      options,
    );
    assert.equal(first.expiryKind, "UNKNOWN");
    assert.equal(first.expiryDate, null);
  });

  it("期限なし・未確認では日付を持たせない", () => {
    const [first] = parseExtraction(
      { items: [item({ expiryKind: "NONE", expiryDate: "2026-09-15" })] },
      options,
    );
    assert.equal(first.expiryKind, "NONE");
    assert.equal(first.expiryDate, null);
  });

  it("商品名が読めなくても、期限が読めていれば候補として残す", () => {
    const [first] = parseExtraction(
      {
        items: [
          item({
            productName: null,
            amount: null,
            expiryKind: "USE_BY",
            expiryDate: "2026-09-15",
          }),
        ],
      },
      options,
    );
    assert.equal(first.productName, null);
    assert.equal(first.expiryDate, "2026-09-15");
  });

  it("商品名・数量・期限のどれも読めなかった行は捨てる", () => {
    const items = parseExtraction(
      { items: [item({ productName: null, amount: null, expiryDate: null })] },
      options,
    );
    assert.equal(items.length, 0);
  });

  it("在庫にしない行（ignore）は落とさず印だけ持って返す", () => {
    const [first] = parseExtraction({ items: [item({ productName: "レジ袋", ignore: true })] }, options);
    assert.equal(first.ignore, true);
  });

  it("画像の枚数の外を指すimageIndexはnullにする", () => {
    const [first] = parseExtraction({ items: [item({ imageIndex: 5 })] }, options);
    assert.equal(first.imageIndex, null);
  });

  it("オブジェクトでない行は飛ばす", () => {
    const items = parseExtraction({ items: ["牛乳", null, item()] }, options);
    assert.equal(items.length, 1);
  });

  it("件数の上限を超えたぶんは捨てる", () => {
    const many = Array.from({ length: INTAKE_ITEM_LIMIT + 10 }, () => item());
    assert.equal(parseExtraction({ items: many }, options).length, INTAKE_ITEM_LIMIT);
  });
});
