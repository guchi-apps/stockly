import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { InventoryInputError } from "../inventory/operations.ts";
import {
  detectSymbology,
  formatBarcode,
  hasValidCheckDigit,
  normalizeBarcode,
  parseBarcode,
  symbologyFromDetectedFormat,
} from "./code.ts";

describe("normalizeBarcode", () => {
  it("全角の数字を半角へ直す", () => {
    assert.equal(normalizeBarcode("４９０１７７７０１８８８４"), "4901777018884");
  });

  it("空白・ハイフン・アンダースコアを落とす", () => {
    assert.equal(normalizeBarcode(" 4901777-018884 "), "4901777018884");
    assert.equal(normalizeBarcode("4 901777 018884"), "4901777018884");
  });

  it("英字は大文字へ揃える（CODE128は英数字を含む）", () => {
    assert.equal(normalizeBarcode("ab12"), "AB12");
  });

  it("nullとundefinedは空文字にする", () => {
    assert.equal(normalizeBarcode(null), "");
    assert.equal(normalizeBarcode(undefined), "");
  });
});

describe("hasValidCheckDigit", () => {
  it("正しいEAN-13を受け付ける", () => {
    assert.equal(hasValidCheckDigit("4901777018884"), true);
    assert.equal(hasValidCheckDigit("4907773010419"), true);
  });

  it("末尾を1つずらしたEAN-13を弾く", () => {
    assert.equal(hasValidCheckDigit("4901777018885"), false);
  });

  it("正しいEAN-8を受け付け、崩したものを弾く", () => {
    assert.equal(hasValidCheckDigit("45690228"), true);
    assert.equal(hasValidCheckDigit("45690221"), false);
  });

  it("桁数が対象外のコードは検証しない", () => {
    assert.equal(hasValidCheckDigit("1234567890"), true);
    assert.equal(hasValidCheckDigit("ABC123"), true);
  });
});

describe("detectSymbology", () => {
  it("45・49で始まる13桁はJAN", () => {
    assert.equal(detectSymbology("4901777018884"), "JAN");
    assert.equal(detectSymbology("4569022812345"), "JAN");
  });

  it("それ以外の13桁はEAN13", () => {
    assert.equal(detectSymbology("8712345678906"), "EAN13");
  });

  it("桁数からEAN8・UPC_Aを見分ける", () => {
    assert.equal(detectSymbology("45690228"), "EAN8");
    assert.equal(detectSymbology("012345678905"), "UPC_A");
  });

  it("数字以外を含むコードは長さでQRとCODE128に分ける", () => {
    assert.equal(detectSymbology("ABC-123"), "CODE128");
    assert.equal(detectSymbology("A".repeat(30)), "QR");
  });
});

describe("symbologyFromDetectedFormat", () => {
  it("ean_13は接頭辞を見てJANとEAN13に分ける", () => {
    assert.equal(symbologyFromDetectedFormat("ean_13", "4901777018884"), "JAN");
    assert.equal(symbologyFromDetectedFormat("ean_13", "8712345678906"), "EAN13");
  });

  it("知らない形式はOTHERにして、読めたこと自体は活かす", () => {
    assert.equal(symbologyFromDetectedFormat("itf", "12345678"), "OTHER");
  });
});

describe("parseBarcode", () => {
  it("正規化したコードとシンボロジーを返す", () => {
    assert.deepEqual(parseBarcode(" 4901777-018884 "), {
      code: "4901777018884",
      symbology: "JAN",
    });
  });

  it("空の入力を拒否する", () => {
    assert.throws(() => parseBarcode("  "), InventoryInputError);
  });

  it("チェックディジットが合わないコードを拒否する", () => {
    assert.throws(
      () => parseBarcode("4901777018885"),
      (error: unknown) => error instanceof InventoryInputError && error.field === "code",
    );
  });

  it("桁の足りない数字を拒否する", () => {
    assert.throws(() => parseBarcode("12345"), InventoryInputError);
  });

  it("使えない文字を含むコードを拒否する", () => {
    assert.throws(() => parseBarcode("４９０１<script>"), InventoryInputError);
  });

  it("欄の名前を指定できる（画面がその欄の下にメッセージを出せるように）", () => {
    assert.throws(
      () => parseBarcode("", "manualCode"),
      (error: unknown) => error instanceof InventoryInputError && error.field === "manualCode",
    );
  });
});

describe("formatBarcode", () => {
  it("パッケージの印字と同じ区切りを入れる", () => {
    assert.equal(formatBarcode("4901777018884"), "4 901777 018884");
    assert.equal(formatBarcode("45690228"), "4569 0228");
  });

  it("区切りを決められないコードはそのまま返す", () => {
    assert.equal(formatBarcode("ABC123"), "ABC123");
  });
});
