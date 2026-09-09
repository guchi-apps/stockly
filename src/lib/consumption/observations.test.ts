import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAX_OBSERVATIONS,
  ObservationFormatError,
  buildObservationInstruction,
  parseObservations,
} from "./observations.ts";

/**
 * モデルの応答の検証（#11）。
 *
 * **モデルAPIには接続しない**（`docs/testing-strategy.md`の「AI候補」の行）。確かめるのは
 * 「返ってきたものをそのまま信じないこと」だけ——ここを抜けた値が、そのまま在庫の減算量の
 * 材料になるため。
 */

describe("parseObservations", () => {
  it("読み取れたものを取り出し、バーコードは数字だけにする", () => {
    const result = parseObservations({
      observations: [
        {
          label: " おいしい牛乳 ",
          barcode: "4902705-001234",
          confidence: 0.9,
          visibleCount: 2,
          remainingRatio: null,
          containerCount: null,
          note: null,
        },
      ],
    });

    assert.equal(result.length, 1);
    assert.equal(result[0].label, "おいしい牛乳");
    assert.equal(result[0].barcode, "4902705001234");
    assert.equal(result[0].visibleCount, 2);
  });

  it("範囲外の値は「読めなかった」として落とす（モデルの出力をそのまま使わない）", () => {
    const result = parseObservations({
      observations: [
        { label: "a", confidence: 5, remainingRatio: 1.5, visibleCount: -3, containerCount: 1.5 },
      ],
    });

    assert.equal(result[0].confidence, 0);
    assert.equal(result[0].remainingRatio, null);
    assert.equal(result[0].visibleCount, null);
    assert.equal(result[0].containerCount, null);
  });

  it("名前が読めなかった行だけを落とし、残りは活かす", () => {
    const result = parseObservations({
      observations: [{ label: "  " }, { label: null }, { label: "水", visibleCount: 1 }],
    });
    assert.deepEqual(
      result.map((row) => row.label),
      ["水"],
    );
  });

  it("件数の上限を超えて返ってきても、上限までしか使わない", () => {
    const many = Array.from({ length: MAX_OBSERVATIONS + 5 }, (_, index) => ({
      label: `商品${index}`,
      confidence: 0.5,
    }));
    assert.equal(parseObservations({ observations: many }).length, MAX_OBSERVATIONS);
  });

  it("読めるものが無ければ空配列（失敗ではない）", () => {
    assert.deepEqual(parseObservations({ observations: [] }), []);
  });

  it("形そのものが違えばエラーにする（画面が「読み取れませんでした」を出す）", () => {
    assert.throws(() => parseObservations({}), ObservationFormatError);
    assert.throws(() => parseObservations(null), ObservationFormatError);
    assert.throws(() => parseObservations({ observations: "壊れた応答" }), ObservationFormatError);
  });
});

describe("buildObservationInstruction", () => {
  it("写真の種類ごとに読ませたいものを変える", () => {
    assert.match(buildObservationInstruction("SHELF"), /visibleCount/);
    assert.match(buildObservationInstruction("REMAINING"), /remainingRatio/);
    assert.match(buildObservationInstruction("EMPTY_CONTAINER"), /containerCount/);
  });

  it("件数の上限を指示に含める（際限なく並べさせない）", () => {
    assert.match(buildObservationInstruction("SHELF"), new RegExp(`${MAX_OBSERVATIONS}件`));
  });
});
