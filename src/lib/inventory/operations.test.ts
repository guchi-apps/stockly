import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  InventoryInputError,
  applyRecordToLot,
  canReverse,
  formatQuantityWithUnit,
  nextLotStatus,
  parseAmount,
  parseDate,
  parseOperationId,
  parseRecordForm,
  parseStockLotForm,
  parseStorageLocationForm,
  resolveExpiry,
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

  it("7日以内はSOON、それより先はFINE", () => {
    assert.equal(resolveExpiry({ bestBeforeDate: day("2026-09-14") }, today).status, "SOON");
    assert.equal(resolveExpiry({ bestBeforeDate: day("2026-09-15") }, today).status, "FINE");
  });

  it("期限が無ければNONE", () => {
    assert.equal(resolveExpiry({}, today).status, "NONE");
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

  it("期限なしを選んだら日付は捨てる", () => {
    const result = parseStockLotForm({ ...base, expiryKind: "NONE" });

    assert.ok(result.ok);
    assert.equal(result.value.expiryDate, null);
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
