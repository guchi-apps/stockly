import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatTokyoDate,
  formatTokyoDateTime,
  toTokyoDateInput,
  tokyoDayNumber,
  tokyoDaysBetween,
  tokyoToday,
} from "./tokyo.ts";

/** 期限の列（MySQLのDATE）と同じ形。Prismaはこれを返す。 */
function day(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

describe("tokyoToday", () => {
  it("UTCとJSTで日付が違う時間帯でも、日本時間の今日を返す", () => {
    // 2026-09-08 23:30 JST（UTCではまだ9/8の14:30）
    assert.deepEqual(tokyoToday(new Date("2026-09-08T14:30:00.000Z")), day("2026-09-08"));
    // 2026-09-09 00:00 JST。ここで日付が変わる
    assert.deepEqual(tokyoToday(new Date("2026-09-08T15:00:00.000Z")), day("2026-09-09"));
    // 2026-09-09 08:59 JST（UTCではまだ9/8）。UTC基準だと1日前になってしまう時間帯
    assert.deepEqual(tokyoToday(new Date("2026-09-08T23:59:00.000Z")), day("2026-09-09"));
    // 2026-09-09 09:00 JST（UTCでも9/9）
    assert.deepEqual(tokyoToday(new Date("2026-09-09T00:00:00.000Z")), day("2026-09-09"));
  });

  it("月・年をまたぐ境目でも日本時間で数える", () => {
    // 2026-01-01 00:00 JST
    assert.deepEqual(tokyoToday(new Date("2025-12-31T15:00:00.000Z")), day("2026-01-01"));
    // 2025-12-31 23:59 JST
    assert.deepEqual(tokyoToday(new Date("2025-12-31T14:59:59.999Z")), day("2025-12-31"));
  });
});

describe("tokyoDayNumber", () => {
  it("日付の列（UTC0時）はカレンダー上の日付のまま扱う", () => {
    assert.equal(tokyoDayNumber(day("2026-09-08")), tokyoDayNumber(new Date("2026-09-08T12:00:00.000Z")));
  });

  it("日をまたぐと1増える", () => {
    assert.equal(tokyoDayNumber(day("2026-09-09")) - tokyoDayNumber(day("2026-09-08")), 1);
  });
});

describe("tokyoDaysBetween", () => {
  it("JSTの0時を過ぎた時点で残り日数が1減る", () => {
    const expiry = day("2026-09-10");
    // 9/9 08:00 JST（UTCでは9/8）→ あと1日
    assert.equal(tokyoDaysBetween(new Date("2026-09-08T23:00:00.000Z"), expiry), 1);
    // 9/10 00:00 JST → 今日まで
    assert.equal(tokyoDaysBetween(new Date("2026-09-09T15:00:00.000Z"), expiry), 0);
    // 9/11 00:00 JST → 1日超過
    assert.equal(tokyoDaysBetween(new Date("2026-09-10T15:00:00.000Z"), expiry), -1);
  });
});

describe("表示", () => {
  it("日付の列を年月日で出す", () => {
    assert.equal(formatTokyoDate(day("2026-09-08")), "2026/09/08");
  });

  it("時刻を持つ値は日本時間へ直して出す", () => {
    // 2026-09-08 07:00 JST
    assert.equal(formatTokyoDateTime(new Date("2026-09-07T22:00:00.000Z")), "09/08 07:00");
    assert.equal(formatTokyoDate(new Date("2026-09-07T22:00:00.000Z")), "2026/09/08");
  });

  it("入力欄の形式へ直す", () => {
    assert.equal(toTokyoDateInput(day("2026-09-08")), "2026-09-08");
    assert.equal(toTokyoDateInput(new Date("2026-09-08T23:30:00.000Z")), "2026-09-09");
  });
});
