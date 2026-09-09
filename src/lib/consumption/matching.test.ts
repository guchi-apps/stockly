import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Decimal, type UnitCode } from "../inventory/units.ts";
import type { VisionObservation } from "./observations.ts";
import {
  buildConsumptionCandidates,
  confidenceLevel,
  matchProduct,
  normalizeLabel,
  oneContainerAmount,
  proposeAmount,
  selectLot,
  type MatchableLot,
} from "./matching.ts";

/**
 * 写真から出した候補の組み立て（#11）。
 *
 * 受入条件の「複数商品・部分消費・判定不能・画像再送」のうち、**画像再送以外はここで確かめる**
 * （再送の一意制約は`db-tests/consumption-scan.test.ts`）。とくに
 * **「在庫に無い商品を候補にしない」ことと「決められない量を埋めないこと」**を落とさない。
 */

function lot(overrides: Partial<MatchableLot> & { id: string }): MatchableLot {
  return {
    productId: `product-${overrides.id}`,
    productName: "商品",
    brand: "",
    aliases: [],
    barcodes: [],
    quantity: new Decimal(1),
    unit: "PIECE" as UnitCode,
    storageLocationName: null,
    storagePositionName: null,
    expiryOn: null,
    openedAt: null,
    contentAmount: null,
    contentUnit: null,
    ...overrides,
  };
}

function seen(overrides: Partial<VisionObservation> & { label: string }): VisionObservation {
  return {
    barcode: null,
    confidence: 0.9,
    visibleCount: null,
    remainingRatio: null,
    containerCount: null,
    note: null,
    ...overrides,
  };
}

const MILK = lot({
  id: "milk",
  productId: "p-milk",
  productName: "おいしい牛乳",
  brand: "明治",
  aliases: ["明治おいしい牛乳900ml"],
  barcodes: ["4902705001234"],
  quantity: new Decimal(2),
  unit: "BOTTLE",
  storageLocationName: "冷蔵庫",
  expiryOn: new Date("2026-09-10T00:00:00.000Z"),
});

const RICE = lot({
  id: "rice",
  productId: "p-rice",
  productName: "サトウのごはん 200g",
  aliases: ["サトウのごはん"],
  quantity: new Decimal(6),
  unit: "PACK",
  storageLocationName: "食品棚",
});

const WATER = lot({
  id: "water",
  productId: "p-water",
  productName: "南アルプスの天然水",
  quantity: new Decimal(2),
  unit: "LITER",
  contentAmount: new Decimal(2),
  contentUnit: "LITER",
  openedAt: new Date("2026-09-07T00:00:00.000Z"),
});

describe("normalizeLabel", () => {
  it("全角・大文字・空白・記号の違いを吸収する", () => {
    assert.equal(normalizeLabel("明治 おいしい牛乳 ９００ｍＬ"), "明治おいしい牛乳900ml");
    assert.equal(normalizeLabel("サトウの・ごはん（200g）"), "サトウのごはん200g");
  });
});

describe("matchProduct", () => {
  const lots = [MILK, RICE, WATER];

  it("バーコードが読めていれば、名前より優先して結び付ける", () => {
    const match = matchProduct(
      seen({ label: "まったく違う名前", barcode: "4902705001234" }),
      lots,
    );
    assert.deepEqual(match, { productId: "p-milk", strength: "BARCODE", matched: "4902705001234" });
  });

  it("ハイフンや空白の混ざったコードでも同じ商品に当たる", () => {
    const match = matchProduct(seen({ label: "x", barcode: "4902705-001234" }), lots);
    assert.equal(match?.productId, "p-milk");
  });

  it("商品名の完全一致は別名より強い", () => {
    const match = matchProduct(seen({ label: "サトウのごはん 200g" }), lots);
    assert.equal(match?.strength, "NAME");
  });

  it("別名でも結び付く", () => {
    const match = matchProduct(seen({ label: "明治おいしい牛乳900ml" }), lots);
    assert.deepEqual(match, {
      productId: "p-milk",
      strength: "ALIAS",
      matched: "明治おいしい牛乳900ml",
    });
  });

  it("部分一致は最後の手段で、強さが下がる", () => {
    const match = matchProduct(seen({ label: "サトウのごはん 5パック入り" }), lots);
    assert.equal(match?.strength, "PARTIAL");
  });

  it("在庫に無いものは結び付かない（＝候補にしない）", () => {
    assert.equal(matchProduct(seen({ label: "ヤクルト 5本パック" }), lots), null);
  });
});

describe("selectLot", () => {
  it("期限がいちばん近いロットを選ぶ（期限なしは後ろ）", () => {
    const soon = lot({ id: "a", expiryOn: new Date("2026-09-10T00:00:00.000Z") });
    const later = lot({ id: "b", expiryOn: new Date("2026-12-01T00:00:00.000Z") });
    const none = lot({ id: "c", expiryOn: null });
    assert.equal(selectLot([none, later, soon], "SHELF")?.lot.id, "a");
  });

  it("残量の写真では開封済みを先に見る", () => {
    const sealed = lot({ id: "sealed", expiryOn: new Date("2026-09-10T00:00:00.000Z") });
    const opened = lot({ id: "opened", openedAt: new Date("2026-09-07T00:00:00.000Z") });
    assert.equal(selectLot([sealed, opened], "REMAINING")?.lot.id, "opened");
    assert.equal(selectLot([sealed, opened], "SHELF")?.lot.id, "sealed");
  });

  it("数量が0のロットは選ばない", () => {
    assert.equal(selectLot([lot({ id: "empty", quantity: new Decimal(0) })], "SHELF"), null);
  });
});

describe("oneContainerAmount", () => {
  it("個数で持っている在庫は1", () => {
    assert.equal(oneContainerAmount(MILK)?.toString(), "1");
  });

  it("容量で持っている在庫は商品の内容量から出す", () => {
    assert.equal(oneContainerAmount(WATER)?.toString(), "2");
  });

  it("内容量が未登録なら決められない", () => {
    assert.equal(oneContainerAmount(lot({ id: "x", unit: "LITER" })), null);
  });
});

describe("proposeAmount", () => {
  it("空き容器は写っている容器のぶんだけ減らす", () => {
    const result = proposeAmount("EMPTY_CONTAINER", seen({ label: "牛乳", containerCount: 2 }), MILK);
    assert.equal("amount" in result && result.amount.toString(), "2");
  });

  it("空き容器の数が分からなければ1つぶんとみなす", () => {
    const result = proposeAmount("EMPTY_CONTAINER", seen({ label: "牛乳" }), MILK);
    assert.equal("amount" in result && result.amount.toString(), "1");
  });

  it("残量からは部分的な消費量を出す", () => {
    const result = proposeAmount("REMAINING", seen({ label: "水", remainingRatio: 0.3 }), WATER);
    assert.equal("amount" in result && result.amount.toString(), "1.4");
  });

  it("残量が読めなければ量を埋めずに理由を返す", () => {
    const result = proposeAmount("REMAINING", seen({ label: "水" }), WATER);
    assert.equal("reason" in result && result.reason, "NO_AMOUNT");
  });

  it("同じ在庫が容器1つぶんを超えて残っているときは、残量から決めない", () => {
    const many = lot({
      id: "water-many",
      unit: "LITER",
      quantity: new Decimal(6),
      contentAmount: new Decimal(2),
      contentUnit: "LITER",
    });
    const result = proposeAmount("REMAINING", seen({ label: "水", remainingRatio: 0.3 }), many);
    assert.equal("reason" in result && result.reason, "NO_AMOUNT");
  });

  it("棚は写っている数と記録の差を減らす", () => {
    const result = proposeAmount("SHELF", seen({ label: "ごはん", visibleCount: 4 }), RICE);
    assert.equal("amount" in result && result.amount.toString(), "2");
  });

  it("棚に記録以上に写っていれば、減った量は無いとして候補にしない", () => {
    const result = proposeAmount("SHELF", seen({ label: "ごはん", visibleCount: 6 }), RICE);
    assert.equal("reason" in result && result.reason, "NO_AMOUNT");
  });

  it("棚から数えられるのは個数の在庫だけ", () => {
    const result = proposeAmount("SHELF", seen({ label: "水", visibleCount: 1 }), WATER);
    assert.equal("reason" in result && result.reason, "UNIT_MISMATCH");
  });

  it("容量の在庫に内容量が無ければ、空き容器からも決められない", () => {
    const result = proposeAmount(
      "EMPTY_CONTAINER",
      seen({ label: "水" }),
      lot({ id: "x", unit: "LITER", quantity: new Decimal(3) }),
    );
    assert.equal("reason" in result && result.reason, "UNIT_MISMATCH");
  });
});

describe("confidenceLevel", () => {
  it("段は0.8と0.5で分かれる", () => {
    assert.equal(confidenceLevel(0.8), "HIGH");
    assert.equal(confidenceLevel(0.79), "MEDIUM");
    assert.equal(confidenceLevel(0.5), "MEDIUM");
    assert.equal(confidenceLevel(0.49), "LOW");
  });
});

describe("buildConsumptionCandidates", () => {
  const lots = [MILK, RICE, WATER];

  it("複数の商品をまとめて候補にし、信頼度の高い順に並べる", () => {
    const result = buildConsumptionCandidates({
      kind: "SHELF",
      lots,
      observations: [
        seen({ label: "サトウのごはん 5パック入り", visibleCount: 4, confidence: 0.9 }),
        seen({ label: "おいしい牛乳", barcode: "4902705001234", visibleCount: 1, confidence: 0.95 }),
      ],
    });

    assert.equal(result.candidates.length, 2);
    assert.equal(result.candidates[0].lot.productId, "p-milk");
    assert.equal(result.candidates[1].lot.productId, "p-rice");
    // バーコード一致は重み1.0、部分一致は0.6。
    assert.equal(result.candidates[0].confidence, 0.95);
    assert.equal(result.candidates[1].confidence, 0.54);
  });

  it("在庫に無い商品は候補にせず、理由を付けて残す", () => {
    const result = buildConsumptionCandidates({
      kind: "EMPTY_CONTAINER",
      lots,
      observations: [seen({ label: "ヤクルト 5本パック" })],
    });

    assert.equal(result.candidates.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].reason, "NO_PRODUCT");
    assert.equal(result.skipped[0].productId, null);
  });

  it("商品はあるが在庫が0なら、NO_STOCKとして商品idごと残す", () => {
    const result = buildConsumptionCandidates({
      kind: "EMPTY_CONTAINER",
      lots: [lot({ id: "z", productId: "p-tea", productName: "麦茶", quantity: new Decimal(0) })],
      observations: [seen({ label: "麦茶" })],
    });

    assert.equal(result.candidates.length, 0);
    assert.equal(result.skipped[0].reason, "NO_STOCK");
    assert.equal(result.skipped[0].productId, "p-tea");
  });

  it("判定不能なものが混ざっても、読めた候補は残る", () => {
    const result = buildConsumptionCandidates({
      kind: "SHELF",
      lots,
      observations: [
        seen({ label: "サトウのごはん 200g", visibleCount: 4 }),
        seen({ label: "白い箱" }),
        seen({ label: "南アルプスの天然水", visibleCount: 1 }),
      ],
    });

    assert.equal(result.candidates.length, 1);
    assert.deepEqual(
      result.skipped.map((row) => row.reason),
      ["NO_PRODUCT", "UNIT_MISMATCH"],
    );
  });

  it("いまの在庫より多くは減らさない", () => {
    const result = buildConsumptionCandidates({
      kind: "EMPTY_CONTAINER",
      lots: [MILK],
      observations: [seen({ label: "おいしい牛乳", containerCount: 5 })],
    });

    assert.equal(result.candidates[0].amount.toString(), "2");
    assert.ok(
      result.candidates[0].evidence.some((line) => line.includes("在庫のぶんまでに丸めています")),
    );
  });

  it("根拠には、読み取った文字・照合した手がかり・ロットの選び方・量の出し方が並ぶ", () => {
    const result = buildConsumptionCandidates({
      kind: "EMPTY_CONTAINER",
      lots: [MILK],
      observations: [seen({ label: "おいしい牛乳", barcode: "4902705001234" })],
    });

    const evidence = result.candidates[0].evidence;
    assert.equal(evidence.length, 4);
    assert.ok(evidence[0].includes("おいしい牛乳"));
    assert.ok(evidence[1].includes("バーコード"));
  });

  it("同じ入力からは必ず同じ結果になる（判定結果を保存しないための前提）", () => {
    const input = {
      kind: "SHELF" as const,
      lots,
      observations: [seen({ label: "サトウのごはん 200g", visibleCount: 4 })],
    };
    const first = buildConsumptionCandidates(input);
    const second = buildConsumptionCandidates(input);

    assert.deepEqual(
      first.candidates.map((row) => [row.lot.id, row.amount.toString(), row.confidence]),
      second.candidates.map((row) => [row.lot.id, row.amount.toString(), row.confidence]),
    );
  });
});
