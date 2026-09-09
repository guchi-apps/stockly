import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addDays, buildStockLotCandidate, shelfLifeDaysBetween } from "./candidate.ts";

const TODAY = new Date("2026-09-08T00:00:00.000Z");

describe("addDays", () => {
  it("暦日で足してYYYY-MM-DDにする", () => {
    assert.equal(addDays(TODAY, 180), "2027-03-07");
    assert.equal(addDays(TODAY, 0), "2026-09-08");
  });

  it("時刻を持った日付でも暦日で数える", () => {
    assert.equal(addDays(new Date("2026-09-08T23:30:00.000Z"), 1), "2026-09-09");
  });
});

describe("shelfLifeDaysBetween", () => {
  it("登録日から期限までの日数を求める", () => {
    assert.equal(shelfLifeDaysBetween(TODAY, new Date("2026-09-15T00:00:00.000Z")), 7);
  });

  it("過ぎた期限は0日にする（次回に負の日数を覚えないため）", () => {
    assert.equal(shelfLifeDaysBetween(TODAY, new Date("2026-09-01T00:00:00.000Z")), 0);
  });
});

describe("buildStockLotCandidate", () => {
  const master = {
    productName: "コカ・コーラ 500mL",
    categoryName: "炭酸飲料",
    defaultUnit: "PIECE" as const,
  };

  const rule = {
    storageLocationId: "loc-pantry",
    storagePositionId: "pos-lower",
    expiryKind: "BEST_BEFORE" as const,
    shelfLifeDays: 180,
    confirmedCount: 3,
  };

  it("確定済みルールが保管場所でマスタより強い", () => {
    const candidate = buildStockLotCandidate({ rule, master, today: TODAY });

    assert.equal(candidate.values.storageLocationId, "loc-pantry");
    assert.equal(candidate.sources.storageLocationId, "RULE");
  });

  it("ルールが持たない商品名・カテゴリ・単位はマスタから採る（正本はProduct）", () => {
    const candidate = buildStockLotCandidate({ rule, master, today: TODAY });

    assert.equal(candidate.values.productName, "コカ・コーラ 500mL");
    assert.equal(candidate.sources.productName, "BARCODE");
    assert.equal(candidate.values.categoryName, "炭酸飲料");
    assert.equal(candidate.sources.categoryName, "BARCODE");
    assert.equal(candidate.values.unit, "PIECE");
    assert.equal(candidate.sources.unit, "BARCODE");
  });

  it("マスタしか無ければマスタの値を出す", () => {
    const candidate = buildStockLotCandidate({ master, today: TODAY });

    assert.equal(candidate.values.categoryName, "炭酸飲料");
    assert.equal(candidate.sources.categoryName, "BARCODE");
    assert.equal(candidate.confirmedCount, 0);
  });

  it("AI候補は確定済みルールとマスタの両方に負ける", () => {
    const candidate = buildStockLotCandidate({
      rule,
      master,
      ai: { productName: "コーラ", categoryName: "ジュース", unit: "CAN" },
      today: TODAY,
    });

    assert.equal(candidate.values.productName, "コカ・コーラ 500mL");
    assert.equal(candidate.sources.productName, "BARCODE");
    assert.equal(candidate.values.categoryName, "炭酸飲料");
    assert.equal(candidate.sources.categoryName, "BARCODE");
    assert.equal(candidate.values.expiryKind, "BEST_BEFORE");
    assert.equal(candidate.sources.expiryKind, "RULE");
  });

  it("AI候補だけがある欄はAI候補を出す", () => {
    const candidate = buildStockLotCandidate({
      ai: { productName: "コーラ" },
      today: TODAY,
    });

    assert.equal(candidate.values.productName, "コーラ");
    assert.equal(candidate.sources.productName, "AI");
  });

  it("期限は日付そのものではなく「今日＋覚えた日数」で出す", () => {
    const candidate = buildStockLotCandidate({ rule, today: TODAY });

    assert.equal(candidate.values.expiryKind, "BEST_BEFORE");
    assert.equal(candidate.values.expiryDate, "2027-03-07");
    assert.equal(candidate.sources.expiryDate, "RULE");
  });

  it("期限なしを覚えているときは期限の欄を埋めない", () => {
    const candidate = buildStockLotCandidate({
      rule: { ...rule, expiryKind: "NONE", shelfLifeDays: null },
      today: TODAY,
    });

    assert.equal(candidate.values.expiryKind, undefined);
    assert.equal(candidate.values.expiryDate, undefined);
  });

  it("保管場所を採れないときは詳細位置も出さない", () => {
    const candidate = buildStockLotCandidate({
      rule: { ...rule, storageLocationId: null },
      today: TODAY,
    });

    assert.equal(candidate.values.storageLocationId, undefined);
    assert.equal(candidate.values.storagePositionId, undefined);
  });

  it("空文字は値なしとして次の候補へ落とす", () => {
    const candidate = buildStockLotCandidate({
      master: { ...master, categoryName: "" },
      ai: { categoryName: "ジュース" },
      today: TODAY,
    });

    assert.equal(candidate.values.categoryName, "ジュース");
    assert.equal(candidate.sources.categoryName, "AI");
  });

  it("数量は候補にしない（毎回その場で決めるもの）", () => {
    const candidate = buildStockLotCandidate({ rule, master, today: TODAY });

    assert.equal("amount" in candidate.values, false);
  });

  it("材料が何も無ければ空の候補を返す", () => {
    const candidate = buildStockLotCandidate({ today: TODAY });

    assert.deepEqual(candidate.values, {});
    assert.deepEqual(candidate.sources, {});
  });
});
