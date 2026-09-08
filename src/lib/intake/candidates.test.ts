import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CONFIDENCE_THRESHOLDS,
  confidenceLevel,
  initialCandidateStatus,
  isApplicable,
  statusAfterEdit,
} from "./candidates.ts";

/** `Prisma.Decimal`の代わり。ここで見ているのは`greaterThan(0)`だけ。 */
function amount(value: number | null) {
  return value === null ? null : { greaterThan: (other: number) => value > other };
}

function candidate(overrides: Partial<Parameters<typeof isApplicable>[0]> = {}) {
  return {
    productName: "米（5kg）",
    amount: amount(1),
    expiryKind: "UNKNOWN",
    expiryDate: null,
    ...overrides,
  };
}

describe("confidenceLevel", () => {
  it("境目で段階が切り替わる", () => {
    assert.equal(confidenceLevel(CONFIDENCE_THRESHOLDS.high), "high");
    assert.equal(confidenceLevel(CONFIDENCE_THRESHOLDS.high - 0.001), "medium");
    assert.equal(confidenceLevel(CONFIDENCE_THRESHOLDS.medium), "medium");
    assert.equal(confidenceLevel(CONFIDENCE_THRESHOLDS.medium - 0.001), "low");
    assert.equal(confidenceLevel(0), "low");
    assert.equal(confidenceLevel(1), "high");
  });
});

describe("initialCandidateStatus", () => {
  it("抽出した候補は必ず確認待ちで、自動確定しない", () => {
    assert.equal(initialCandidateStatus({ ignore: false }), "PENDING");
  });

  it("在庫にしない行（小計・値引き・レジ袋）だけ、はじめから却下にする", () => {
    assert.equal(initialCandidateStatus({ ignore: true }), "REJECTED");
  });

  it("確からしさは引数に取らない（閾値で自動確定する余地を作らない）", () => {
    // 「confidenceを渡せば確定になる」形にしていないことを、シグネチャで確かめる。
    assert.equal(initialCandidateStatus.length, 1);
    assert.equal(
      initialCandidateStatus({ ignore: false, confidence: 1 } as { ignore: boolean }),
      "PENDING",
    );
  });
});

describe("statusAfterEdit", () => {
  it("直した候補は確認待ちへ戻す（却下したまま直しても反映できるようにする）", () => {
    assert.equal(statusAfterEdit(), "PENDING");
  });
});

describe("isApplicable", () => {
  it("商品名と数量がそろっていれば在庫にできる", () => {
    assert.equal(isApplicable(candidate()), true);
  });

  it("商品名が読めていなければ在庫にできない", () => {
    assert.equal(isApplicable(candidate({ productName: "" })), false);
    assert.equal(isApplicable(candidate({ productName: "  " })), false);
  });

  it("数量が読めていない・0以下なら在庫にできない", () => {
    assert.equal(isApplicable(candidate({ amount: null })), false);
    assert.equal(isApplicable(candidate({ amount: amount(0) })), false);
  });

  it("日付を持つ種別なのに日付が無い組み合わせは在庫にできない", () => {
    assert.equal(isApplicable(candidate({ expiryKind: "BEST_BEFORE" })), false);
    assert.equal(isApplicable(candidate({ expiryKind: "USE_BY" })), false);
    assert.equal(
      isApplicable(candidate({ expiryKind: "USE_BY", expiryDate: new Date("2026-09-15") })),
      true,
    );
  });

  it("期限が未確認・期限なしのままでも在庫にできる（要確認として一覧に出る）", () => {
    assert.equal(isApplicable(candidate({ expiryKind: "UNKNOWN" })), true);
    assert.equal(isApplicable(candidate({ expiryKind: "NONE" })), true);
  });
});
