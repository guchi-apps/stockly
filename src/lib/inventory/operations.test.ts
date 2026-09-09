import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  InventoryInputError,
  applyRecordToLot,
  canReverse,
  convertLotUnit,
  formatQuantityWithUnit,
  nextLotStatus,
  parseAmount,
  parseDate,
  parseExpirySettingsForm,
  parseOperationId,
  parseProductDisasterForm,
  parseRecordForm,
  parseStockLotForm,
  parseStorageLocationForm,
  resolveExpiry,
  resolveUnitChangeAdjustment,
  signedDelta,
} from "./operations.ts";
import { Decimal, quantity } from "./units.ts";

function day(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

describe("parseAmount", () => {
  it("小数の数量をそのまま読む（0.4ロールのような使いかけ）", () => {
    assert.equal(parseAmount("0.4", "amount").toString(), "0.4");
  });

  it("全角数字と桁区切りのカンマを受け付ける", () => {
    assert.equal(parseAmount("１２", "amount").toString(), "12");
    assert.equal(parseAmount("1,200", "amount").toString(), "1200");
  });

  it("空・0・負の数・文字は入力エラーにする", () => {
    for (const input of ["", "0", "-1", "いくつか"]) {
      assert.throws(() => parseAmount(input, "amount"), InventoryInputError);
    }
  });

  it("DBの桁数(小数3桁)を超える入力を拒否する", () => {
    assert.throws(() => parseAmount("0.4001", "amount"), /3桁まで/);
  });

  it("エラーには入力欄の名前が入る（画面がその欄の下に出せるように）", () => {
    try {
      parseAmount("", "amount");
      assert.fail("エラーになるはず");
    } catch (error) {
      assert.ok(error instanceof InventoryInputError);
      assert.equal(error.field, "amount");
    }
  });
});

describe("parseDate", () => {
  it("YYYY-MM-DDをUTCの0時として読む（時差で前日にならない）", () => {
    assert.equal(parseDate("2026-08-20", "expiryDate")?.toISOString(), "2026-08-20T00:00:00.000Z");
  });

  it("空文字は期限なしとしてnull", () => {
    assert.equal(parseDate("", "expiryDate"), null);
  });

  it("存在しない日付を拒否する", () => {
    assert.throws(() => parseDate("2026-02-30", "expiryDate"), InventoryInputError);
  });

  it("YYYY-MM（年月のみ）は、その月の最終日として読む", () => {
    assert.equal(parseDate("2026-09", "expiryDate")?.toISOString(), "2026-09-30T00:00:00.000Z");
  });

  it("年月のみでも、うるう年の2月は29日まで正しく数える", () => {
    assert.equal(parseDate("2024-02", "expiryDate")?.toISOString(), "2024-02-29T00:00:00.000Z");
    assert.equal(parseDate("2026-02", "expiryDate")?.toISOString(), "2026-02-28T00:00:00.000Z");
  });

  it("年月のみは、時差の影響を受けないUTCの暦で月末を数える（30日・31日の月）", () => {
    // JSTのローカル時刻で `new Date(year, month, 0)` のように組むと、
    // UTCの日付が1日手前にずれる（計画レビューでの指摘）。`Date.UTC`基準であることを固定する。
    assert.equal(
      parseDate("2026-04", "expiryDate")?.toISOString(),
      new Date(Date.UTC(2026, 3, 30)).toISOString(),
    );
    assert.equal(
      parseDate("2026-12", "expiryDate")?.toISOString(),
      new Date(Date.UTC(2026, 11, 31)).toISOString(),
    );
  });

  it("存在しない月（年月のみ）を拒否する", () => {
    assert.throws(() => parseDate("2026-13", "expiryDate"), InventoryInputError);
    assert.throws(() => parseDate("2026-00", "expiryDate"), InventoryInputError);
  });
});

describe("parseOperationId", () => {
  it("二重送信の判定に使う値なので、形式を満たさないものは弾く", () => {
    assert.equal(parseOperationId("01927f2a-6b2c-7d1e-8f00-2a3b4c5d6e7f").length, 36);
    for (const input of ["", "short", "a".repeat(65), "id with space"]) {
      assert.throws(() => parseOperationId(input), InventoryInputError);
    }
  });
});

describe("signedDelta", () => {
  it("消費・廃棄は負、補充・訂正は正（画面は常に正の数量を渡す）", () => {
    assert.equal(signedDelta("CONSUME", new Decimal("1")).toString(), "-1");
    assert.equal(signedDelta("DISPOSE", new Decimal("2")).toString(), "-2");
    assert.equal(signedDelta("PURCHASE", new Decimal("3")).toString(), "3");
    assert.equal(signedDelta("ADJUST", new Decimal("4")).toString(), "4");
  });
});

describe("applyRecordToLot", () => {
  it("履歴を積んだあとの数量を返す", () => {
    const next = applyRecordToLot(quantity("4", "PACK"), {
      type: "CONSUME",
      quantityDelta: new Decimal("-1"),
      unit: "PACK",
    });

    assert.equal(next.amount.toString(), "3");
  });

  it("在庫が足りない消費を止める", () => {
    assert.throws(
      () =>
        applyRecordToLot(quantity("1", "PIECE"), {
          type: "CONSUME",
          quantityDelta: new Decimal("-2"),
          unit: "PIECE",
        }),
      /在庫が足りません（残り1個）/,
    );
  });

  it("取消で数量が負になる場合は許す（履歴を戻す操作は止めない）", () => {
    const next = applyRecordToLot(
      quantity("0", "PIECE"),
      { type: "REVERSAL", quantityDelta: new Decimal("-2"), unit: "PIECE" },
      { allowNegative: true },
    );

    assert.equal(next.amount.toString(), "-2");
  });

  it("換算できない単位の記録を拒否する", () => {
    assert.throws(
      () =>
        applyRecordToLot(quantity("1", "BOTTLE"), {
          type: "CONSUME",
          quantityDelta: new Decimal("-1"),
          unit: "PIECE",
        }),
      /合算できません/,
    );
  });

  it("換算できる単位（L→mL）はそのまま積める", () => {
    const next = applyRecordToLot(quantity("2000", "MILLILITER"), {
      type: "CONSUME",
      quantityDelta: new Decimal("-1"),
      unit: "LITER",
    });

    assert.equal(next.amount.toString(), "1000");
  });
});

describe("convertLotUnit", () => {
  it("換算できる単位（kg→g）へ数量を換算する", () => {
    const converted = convertLotUnit(quantity("1.5", "KILOGRAM"), "GRAM");

    assert.equal(converted.amount.toString(), "1500");
    assert.equal(converted.unit, "GRAM");
  });

  it("同じ単位を指定すると数量はそのまま", () => {
    const converted = convertLotUnit(quantity("3", "PIECE"), "PIECE");

    assert.equal(converted.amount.toString(), "3");
  });

  it("換算できない単位（個数系どうし）への変更を拒否する", () => {
    assert.throws(
      () => convertLotUnit(quantity("3", "PIECE"), "PACK"),
      /変更できません/,
    );
  });

  it("換算できない単位（次元が違う）への変更を拒否する", () => {
    assert.throws(
      () => convertLotUnit(quantity("500", "GRAM"), "MILLILITER"),
      /変更できません/,
    );
  });
});

describe("resolveUnitChangeAdjustment", () => {
  it("単位が同じで数量も同じなら訂正なし（null）", () => {
    const adjustment = resolveUnitChangeAdjustment(
      quantity("3", "PIECE"),
      "PIECE",
      new Decimal("3"),
    );

    assert.equal(adjustment, null);
  });

  it("単位を変えても入力値が換算後と一致すれば訂正なし", () => {
    const adjustment = resolveUnitChangeAdjustment(
      quantity("1.5", "KILOGRAM"),
      "GRAM",
      new Decimal("1500"),
    );

    assert.equal(adjustment, null);
  });

  it("登録ミスの訂正: kgのつもりでgとして登録した数量をgへ直す", () => {
    // 現在庫は「1.5」だが単位はKILOGRAM（誤登録）。gへ直し、数量欄は1.5のまま
    // （数字自体は正しいという前提）。現在庫をgへ換算すると1500gなので、
    // 差分は 1.5 - 1500 = -1498.5g がADJUSTとして残る。
    const adjustment = resolveUnitChangeAdjustment(
      quantity("1.5", "KILOGRAM"),
      "GRAM",
      new Decimal("1.5"),
    );

    assert.ok(adjustment !== null);
    assert.equal(adjustment.toString(), "-1498.5");
  });

  it("換算後の数量が小数3桁に収まらない場合は拒否する（丸めて通さない）", () => {
    // 123.456g → kgへ換算すると0.123456kgになり、小数第3位までのDB列に収まらない。
    assert.throws(
      () =>
        resolveUnitChangeAdjustment(quantity("123.456", "GRAM"), "KILOGRAM", new Decimal("0.123")),
      /収まりません/,
    );
  });

  it("換算できない単位を渡すとconvertLotUnitと同じ理由で拒否する", () => {
    assert.throws(
      () => resolveUnitChangeAdjustment(quantity("1", "PIECE"), "PACK", new Decimal("1")),
      /変更できません/,
    );
  });
});

describe("nextLotStatus", () => {
  it("0になったら、廃棄はDISCARDED・それ以外はDEPLETED", () => {
    assert.equal(nextLotStatus(quantity("0", "PIECE"), "DISPOSE"), "DISCARDED");
    assert.equal(nextLotStatus(quantity("0", "PIECE"), "CONSUME"), "DEPLETED");
    assert.equal(nextLotStatus(quantity("1", "PIECE"), "CONSUME"), "ACTIVE");
  });

  it("取消で数量が戻ればACTIVEへ戻る", () => {
    assert.equal(nextLotStatus(quantity("2", "PIECE"), "REVERSAL"), "ACTIVE");
  });

  it("負の数量はACTIVEのまま残す（一覧から消えると訂正できなくなるため）", () => {
    assert.equal(nextLotStatus(quantity("-1", "PIECE"), "REVERSAL"), "ACTIVE");
  });
});

describe("resolveExpiry", () => {
  const today = day("2026-09-07");

  it("期限切れ（サトウのごはん）を日数つきで返す", () => {
    const state = resolveExpiry({ bestBeforeDate: day("2026-08-20") }, today);

    assert.equal(state.status, "EXPIRED");
    assert.equal(state.kind, "BEST_BEFORE");
    assert.equal(state.daysLeft, -18);
  });

  it("当日はまだ期限切れにしない", () => {
    assert.equal(resolveExpiry({ useByDate: today }, today).status, "SOON");
  });

  it("賞味期限は7日以内がSOON、それより先はFINE（既定値）", () => {
    assert.equal(resolveExpiry({ bestBeforeDate: day("2026-09-14") }, today).status, "SOON");
    assert.equal(resolveExpiry({ bestBeforeDate: day("2026-09-15") }, today).status, "FINE");
  });

  it("消費期限は賞味期限より短い日数で判定する（既定は3日）", () => {
    assert.equal(resolveExpiry({ useByDate: day("2026-09-10") }, today).status, "SOON");
    assert.equal(resolveExpiry({ useByDate: day("2026-09-11") }, today).status, "FINE");
    // 同じ日付でも、賞味期限なら「期限間近」になる。
    assert.equal(resolveExpiry({ bestBeforeDate: day("2026-09-11") }, today).status, "SOON");
  });

  it("しきい値は家庭ごとに変えられる", () => {
    const policy = { bestBeforeSoonDays: 1, useBySoonDays: 0 };

    assert.equal(resolveExpiry({ bestBeforeDate: day("2026-09-09") }, today, policy).status, "FINE");
    assert.equal(resolveExpiry({ useByDate: day("2026-09-08") }, today, policy).status, "FINE");
    assert.equal(resolveExpiry({ useByDate: today }, today, policy).status, "SOON");
  });

  it("期限が未入力ならUNKNOWN（期限内とはみなさない）", () => {
    const state = resolveExpiry({}, today);

    assert.equal(state.status, "UNKNOWN");
    assert.equal(state.kind, "UNKNOWN");
    assert.equal(state.daysLeft, null);
  });

  it("「期限なし」と決めた在庫は要確認にしない", () => {
    const state = resolveExpiry({ noExpiry: true }, today);

    assert.equal(state.status, "NONE");
    assert.equal(state.kind, "NONE");
  });

  it("日付の境目は日本時間の0時（UTCの日付では判定しない）", () => {
    const expiry = { useByDate: day("2026-09-08") };

    // 2026-09-08 23:00 JST。まだ当日なので「今日まで」。
    const beforeMidnight = resolveExpiry(expiry, new Date("2026-09-08T14:00:00.000Z"));
    assert.equal(beforeMidnight.status, "SOON");
    assert.equal(beforeMidnight.daysLeft, 0);

    // 2026-09-09 00:30 JST。UTCではまだ9/8だが、日本時間では日付が変わっている。
    const afterMidnight = resolveExpiry(expiry, new Date("2026-09-08T15:30:00.000Z"));
    assert.equal(afterMidnight.status, "EXPIRED");
    assert.equal(afterMidnight.daysLeft, -1);

    // 2026-09-09 08:00 JST（UTCではまだ9/8）。UTC基準だと期限切れを見落とす時間帯。
    assert.equal(resolveExpiry(expiry, new Date("2026-09-08T23:00:00.000Z")).status, "EXPIRED");
  });

  it("消費期限と賞味期限があれば、切れると困る消費期限を優先する", () => {
    const state = resolveExpiry(
      { useByDate: day("2026-09-08"), bestBeforeDate: day("2027-01-01") },
      today,
    );

    assert.equal(state.kind, "USE_BY");
    assert.equal(state.daysLeft, 1);
  });
});

describe("parseRecordForm", () => {
  it("操作ID・種別・数量をまとめて読む", () => {
    const result = parseRecordForm({
      operationId: "01927f2a-6b2c-7d1e-8f00-2a3b4c5d6e7f",
      type: "CONSUME",
      amount: "1",
      note: " 夜ごはん ",
    });

    assert.ok(result.ok);
    assert.equal(result.value.type, "CONSUME");
    assert.equal(result.value.amount.toString(), "1");
    assert.equal(result.value.note, "夜ごはん");
  });

  it("取消（REVERSAL）は画面から記録できない", () => {
    const result = parseRecordForm({
      operationId: "01927f2a-6b2c-7d1e-8f00-2a3b4c5d6e7f",
      type: "REVERSAL",
      amount: "1",
    });

    assert.ok(!result.ok);
    assert.match(result.errors.type, /操作の種類/);
  });
});

describe("parseStockLotForm", () => {
  const base = {
    productName: "カップ麺 しょうゆ",
    amount: "2",
    unit: "PIECE",
    storageLocationId: "loc-pantry",
    expiryKind: "BEST_BEFORE",
    expiryDate: "2026-09-28",
  };

  it("在庫の登録に必要な値を読む", () => {
    const result = parseStockLotForm(base);

    assert.ok(result.ok);
    assert.equal(result.value.productName, "カップ麺 しょうゆ");
    assert.equal(result.value.categoryName, null);
    assert.equal(result.value.unit, "PIECE");
    assert.equal(result.value.expiryDate?.toISOString(), "2026-09-28T00:00:00.000Z");
  });

  it("商品名が無ければエラー", () => {
    const result = parseStockLotForm({ ...base, productName: "  " });

    assert.ok(!result.ok);
    assert.match(result.errors.productName, /商品名/);
  });

  it("期限の種類を選んだのに日付が無ければエラー", () => {
    const result = parseStockLotForm({ ...base, expiryDate: "" });

    assert.ok(!result.ok);
    assert.match(result.errors.expiryDate, /日付/);
  });

  it("期限を年月のみ（YYYY-MM）で入力したら、その月の最終日として保存する", () => {
    const result = parseStockLotForm({ ...base, expiryDate: "2026-09" });

    assert.ok(result.ok);
    assert.equal(result.value.expiryDate?.toISOString(), "2026-09-30T00:00:00.000Z");
  });

  it("期限なしを選んだら日付は捨てる", () => {
    const result = parseStockLotForm({ ...base, expiryKind: "NONE" });

    assert.ok(result.ok);
    assert.equal(result.value.expiryKind, "NONE");
    assert.equal(result.value.expiryDate, null);
  });

  it("未確認（既定）でも日付を求めない。期限なしとは別の種別として返す", () => {
    const result = parseStockLotForm({ ...base, expiryKind: "UNKNOWN", expiryDate: "" });

    assert.ok(result.ok);
    assert.equal(result.value.expiryKind, "UNKNOWN");
    assert.equal(result.value.expiryDate, null);

    // 種別を送らなかった場合も「未確認」に倒す（期限内として黙って通さない）。
    const omitted = parseStockLotForm({ ...base, expiryKind: undefined, expiryDate: "" });
    assert.ok(omitted.ok);
    assert.equal(omitted.value.expiryKind, "UNKNOWN");
  });

  it("保管場所を選ばずに詳細位置だけを指定させない", () => {
    const result = parseStockLotForm({ ...base, storageLocationId: "", storagePositionId: "pos-1" });

    assert.ok(!result.ok);
    assert.match(result.errors.storageLocationId, /保管場所/);
  });
});

describe("parseStorageLocationForm", () => {
  it("名前と種類・温度帯を読む", () => {
    const result = parseStorageLocationForm({
      name: "防災バッグ",
      kind: "EMERGENCY_STOCK",
      temperatureZone: "AMBIENT",
    });

    assert.ok(result.ok);
    assert.equal(result.value.kind, "EMERGENCY_STOCK");
  });

  it("知らない種類・温度帯は既定値へ倒す", () => {
    const result = parseStorageLocationForm({ name: "洗面所", kind: "UNKNOWN" });

    assert.ok(result.ok);
    assert.equal(result.value.kind, "OTHER");
    assert.equal(result.value.temperatureZone, "AMBIENT");
  });
});

describe("parseProductDisasterForm", () => {
  it("役割と数量、加熱/水の要否、温度帯を読む", () => {
    const result = parseProductDisasterForm({
      emergencyRole: "STAPLE_FOOD",
      servingsPerUnit: "3",
      usesPerUnit: "",
      requiresHeating: "on",
      requiresWater: "",
      temperatureZone: "AMBIENT",
    });

    assert.ok(result.ok);
    assert.equal(result.value.emergencyRole, "STAPLE_FOOD");
    assert.equal(result.value.servingsPerUnit?.toString(), "3");
    assert.equal(result.value.usesPerUnit, null);
    assert.equal(result.value.requiresHeating, true);
    assert.equal(result.value.requiresWater, false);
    assert.equal(result.value.temperatureZone, "AMBIENT");
  });

  it("空欄の役割・温度帯は既定値（対象外・常温）へ倒す", () => {
    const result = parseProductDisasterForm({});

    assert.ok(result.ok);
    assert.equal(result.value.emergencyRole, "NONE");
    assert.equal(result.value.servingsPerUnit, null);
    assert.equal(result.value.usesPerUnit, null);
    assert.equal(result.value.temperatureZone, "AMBIENT");
  });

  it("知らない役割はエラーにする（既定値へ黙って倒さない）", () => {
    const result = parseProductDisasterForm({ emergencyRole: "SUPERHERO" });

    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors.emergencyRole);
  });

  it("1単位あたりの食数・使用回数は0を拒否する（空欄にするか1以上を入れる）", () => {
    const result = parseProductDisasterForm({ servingsPerUnit: "0" });

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.errors.servingsPerUnit, /0より大きい/);
  });

  it("小数3桁を超える入力を拒否する", () => {
    const result = parseProductDisasterForm({ usesPerUnit: "1.2345" });

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.errors.usesPerUnit, /3桁まで/);
  });

  it("全角数字を受け付ける", () => {
    const result = parseProductDisasterForm({ servingsPerUnit: "２" });

    assert.ok(result.ok);
    assert.equal(result.value.servingsPerUnit?.toString(), "2");
  });

  it("内容量と単位を両方入れると通る（本単位の飲料をLITERへ換算するために使う）", () => {
    const result = parseProductDisasterForm({ contentAmount: "2", contentUnit: "LITER" });

    assert.ok(result.ok);
    assert.equal(result.value.contentAmount?.toString(), "2");
    assert.equal(result.value.contentUnit, "LITER");
  });

  it("内容量だけ・単位だけの片方だけはエラーにする（設定したのに効かない値を作らせない）", () => {
    const amountOnly = parseProductDisasterForm({ contentAmount: "2" });
    assert.equal(amountOnly.ok, false);
    if (!amountOnly.ok) assert.match(amountOnly.errors.contentAmount, /どちらも/);

    const unitOnly = parseProductDisasterForm({ contentUnit: "LITER" });
    assert.equal(unitOnly.ok, false);
    if (!unitOnly.ok) assert.match(unitOnly.errors.contentAmount, /どちらも/);
  });

  it("知らない単位はエラーにする", () => {
    const result = parseProductDisasterForm({ contentAmount: "2", contentUnit: "PARSEC" });

    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors.contentUnit);
  });
});

describe("canReverse", () => {
  const entries = [
    { id: "t1", type: "CONSUME" as const, reversesTransactionId: null },
    { id: "t2", type: "REVERSAL" as const, reversesTransactionId: "t1" },
    { id: "t3", type: "PURCHASE" as const, reversesTransactionId: null },
  ];

  it("取消済みの履歴は取り消せない", () => {
    assert.equal(canReverse(entries[0], entries), false);
  });

  it("取消行そのものは取り消せない", () => {
    assert.equal(canReverse(entries[1], entries), false);
  });

  it("直前でなくても、取り消されていない履歴なら取り消せる", () => {
    assert.equal(canReverse(entries[2], entries), true);
  });
});

describe("formatQuantityWithUnit", () => {
  it("末尾の余分な0を落とす", () => {
    assert.equal(formatQuantityWithUnit(new Decimal("0.400"), "ROLL"), "0.4ロール");
    assert.equal(formatQuantityWithUnit(new Decimal("3"), "USE"), "3回");
  });
});

describe("parseExpirySettingsForm", () => {
  it("日数と切り替えをまとめて読む", () => {
    const result = parseExpirySettingsForm({
      bestBeforeSoonDays: "10",
      useBySoonDays: "０", // 全角も受け付ける（スマホの入力で混ざる）
      highlightUnknownExpiry: "on",
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value, {
      bestBeforeSoonDays: 10,
      useBySoonDays: 0,
      highlightUnknownExpiry: true,
      // チェックが外れた欄はフォームから送られてこない＝オフ。
      notifyEnabled: false,
    });
  });

  it("負の数・小数・上限超えを弾く", () => {
    for (const value of ["-1", "3.5", "366", "毎日"]) {
      const result = parseExpirySettingsForm({ bestBeforeSoonDays: value, useBySoonDays: "3" });
      assert.equal(result.ok, false, `${value} は受け付けない`);
      if (result.ok) return;
      assert.ok(result.errors.bestBeforeSoonDays);
    }
  });

  it("空欄は入力を促す", () => {
    const result = parseExpirySettingsForm({ bestBeforeSoonDays: "7", useBySoonDays: "" });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.errors.useBySoonDays, /入力してください/);
  });
});
