import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildExpiryNotification,
  expiryDedupeKey,
  type ExpiryTarget,
} from "./expiry-message.ts";

function target(
  lotId: string,
  productName: string,
  status: ExpiryTarget["status"],
  daysLeft: number,
): ExpiryTarget {
  return { lotId, productName, status, daysLeft };
}

const TOFU = target("lot-1", "木綿豆腐", "EXPIRED", -2);
const MILK = target("lot-2", "牛乳 1L", "SOON", 0);
const NATTO = target("lot-3", "納豆 3P", "SOON", 3);
const BREAD = target("lot-4", "食パン", "SOON", 4);

describe("expiryDedupeKey", () => {
  it("同じ顔ぶれ・同じ状態なら、並び順が違っても同じキーになる", () => {
    assert.equal(expiryDedupeKey([TOFU, MILK]), expiryDedupeKey([MILK, TOFU]));
  });

  it("状態が変われば別のキーになる（期限間近→期限切れでもう一度届く）", () => {
    const becameExpired = target("lot-2", "牛乳 1L", "EXPIRED", -1);
    assert.notEqual(expiryDedupeKey([MILK]), expiryDedupeKey([becameExpired]));
  });

  it("対象が増えれば別のキーになる", () => {
    assert.notEqual(expiryDedupeKey([TOFU]), expiryDedupeKey([TOFU, MILK]));
  });

  it("日数だけが変わってもキーは変わらない（毎日鳴らさないため）", () => {
    const oneMoreDay = target("lot-1", "木綿豆腐", "EXPIRED", -3);
    assert.equal(expiryDedupeKey([TOFU]), expiryDedupeKey([oneMoreDay]));
  });

  it("列の長さ（VARCHAR(120)）に収まる", () => {
    assert.ok(expiryDedupeKey([TOFU, MILK, NATTO, BREAD]).length <= 120);
  });
});

describe("buildExpiryNotification", () => {
  it("対象が無ければ通知そのものを作らない", () => {
    assert.equal(buildExpiryNotification([]), null);
  });

  it("件数を見出しに、急ぐものから3件までを本文に出す", () => {
    const draft = buildExpiryNotification([BREAD, NATTO, MILK, TOFU]);

    assert.equal(draft?.title, "期限切れ1件・期限間近3件");
    assert.equal(draft?.body, "木綿豆腐（2日超過）、牛乳 1L（今日まで）、納豆 3P（あと3日） ほか1件");
    assert.equal(draft?.payload.expired, 1);
    assert.equal(draft?.payload.soon, 3);
  });

  it("期限切れだけ・期限間近だけのときは、その言い方にする", () => {
    assert.equal(buildExpiryNotification([TOFU])?.title, "期限切れ1件");
    assert.equal(buildExpiryNotification([MILK, NATTO])?.title, "期限間近2件");
  });

  it("根拠として対象のロットidを残す", () => {
    const draft = buildExpiryNotification([MILK, TOFU]);
    assert.deepEqual(
      draft?.payload.targets.map((row) => row.lotId),
      ["lot-1", "lot-2"],
    );
  });
});
