import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compareByExpiry,
  groupConsumptionCandidates,
  matchesExpiryFilter,
  parseExpiryFilter,
  summarizeExpiry,
} from "./expiry.ts";
import { resolveExpiry, type ExpiryState } from "./operations.ts";

function day(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** 2026-09-08 12:00 JST。既定のしきい値（賞味7日・消費3日）で判定する。 */
const NOW = new Date("2026-09-08T03:00:00.000Z");

function lot(name: string, expiry: { bestBeforeDate?: Date; useByDate?: Date; noExpiry?: boolean }) {
  return { product: { name }, expiry: resolveExpiry(expiry, NOW) };
}

describe("parseExpiryFilter", () => {
  it("知らない値は「すべて」に倒す", () => {
    assert.equal(parseExpiryFilter("expired"), "expired");
    assert.equal(parseExpiryFilter("unknown"), "unknown");
    assert.equal(parseExpiryFilter("DROP TABLE"), "all");
    assert.equal(parseExpiryFilter(undefined), "all");
  });
});

describe("matchesExpiryFilter", () => {
  const expired = resolveExpiry({ useByDate: day("2026-09-01") }, NOW);
  const unknown = resolveExpiry({}, NOW);

  it("状態ごとに絞り込める", () => {
    assert.equal(matchesExpiryFilter(expired, "expired"), true);
    assert.equal(matchesExpiryFilter(expired, "unknown"), false);
    assert.equal(matchesExpiryFilter(unknown, "unknown"), true);
  });

  it("「すべて」はどの状態も通す", () => {
    assert.equal(matchesExpiryFilter(unknown, "all"), true);
    assert.equal(matchesExpiryFilter(expired, "all"), true);
  });
});

describe("summarizeExpiry", () => {
  it("期限不明を「期限内」に混ぜず、別に数える", () => {
    const states: ExpiryState[] = [
      resolveExpiry({ useByDate: day("2026-09-06") }, NOW), // 期限切れ
      resolveExpiry({ useByDate: day("2026-09-01") }, NOW), // 期限切れ（7日超過）
      resolveExpiry({ useByDate: day("2026-09-09") }, NOW), // 期限間近
      resolveExpiry({ bestBeforeDate: day("2027-01-01") }, NOW), // 期限内
      resolveExpiry({}, NOW), // 要確認
      resolveExpiry({}, NOW), // 要確認
      resolveExpiry({ noExpiry: true }, NOW), // 期限なし（利用者が決めた）
    ];

    const summary = summarizeExpiry(states);

    assert.deepEqual(summary, {
      expired: 2,
      soon: 1,
      fine: 1,
      unknown: 2,
      none: 1,
      total: 7,
      worstOverdueDays: 7,
    });
  });

  it("期限切れが無ければ超過日数はnull", () => {
    assert.equal(summarizeExpiry([resolveExpiry({}, NOW)]).worstOverdueDays, null);
  });
});

describe("compareByExpiry", () => {
  it("期限が早い順に並び、期限が入っていないものは最後になる", () => {
    const rows = [
      lot("小麦粉", {}),
      lot("食パン", { bestBeforeDate: day("2026-09-12") }),
      lot("木綿豆腐", { useByDate: day("2026-09-06") }),
      lot("乾電池", {}),
    ];

    const names = [...rows].sort(compareByExpiry).map((row) => row.product.name);

    // 期限が同じ（入っていない）ものどうしは商品名の五十音順。
    assert.deepEqual(names, ["木綿豆腐", "食パン", "乾電池", "小麦粉"]);
  });
});

describe("groupConsumptionCandidates", () => {
  const rows = [
    lot("食パン", { bestBeforeDate: day("2026-09-12") }), // 期限間近（賞味7日）
    lot("木綿豆腐", { useByDate: day("2026-09-06") }), // 期限切れ
    lot("小麦粉", {}), // 要確認
    lot("牛乳", { useByDate: day("2026-09-09") }), // 期限間近（消費3日）
    lot("ミネラルウォーター", { bestBeforeDate: day("2027-03-01") }), // 期限内
    lot("ガムテープ", { noExpiry: true }), // 期限なし（候補にも要確認にも出さない）
  ];

  it("期限切れ→期限間近→要確認の順にまとめ、期限内は候補に出さない", () => {
    const { groups, total } = groupConsumptionCandidates(rows);

    assert.deepEqual(
      groups.map((group) => [group.key, group.rows.map((row) => row.product.name)]),
      [
        ["EXPIRED", ["木綿豆腐"]],
        ["SOON", ["牛乳", "食パン"]],
        ["UNKNOWN", ["小麦粉"]],
      ],
    );
    assert.equal(total, 4);
  });

  it("要確認を候補から外しても、他の組は変わらない", () => {
    const { groups } = groupConsumptionCandidates(rows, { includeUnknown: false });
    assert.deepEqual(groups.map((group) => group.key), ["EXPIRED", "SOON"]);
  });

  it("上限で切っても、切る前の件数を残す", () => {
    const { groups } = groupConsumptionCandidates(rows, { limitPerGroup: 1 });
    const soon = groups.find((group) => group.key === "SOON");

    assert.equal(soon?.rows.length, 1);
    assert.equal(soon?.total, 2);
  });
});
