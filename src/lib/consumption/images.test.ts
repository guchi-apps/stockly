import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { InventoryInputError } from "../inventory/operations.ts";
import { fingerprintImages, prepareImages } from "./images.ts";

/**
 * 送る写真の受け入れ検査と指紋（#11）。
 *
 * 形式の判定とEXIF除去そのものは`src/lib/intake/image.test.ts`（#10）が確かめているので、
 * ここで見るのは**#11が足した部分**——何枚目が駄目かが伝わること、上限の境目、
 * そして「同じ写真かどうか」の見分け方。
 */

/** 最小限のJPEG: SOI + APP1（Exif相当・落とされる）+ APP0 + SOS + データ + EOI。 */
function jpeg(...tail: number[]): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xe1, 0x00, 0x06, 0x45, 0x78, 0x69, 0x66, // APP1「Exif」
    0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, // APP0 JFIF
    0xff, 0xda, 0x00, 0x03, 0x01, // SOS
    ...(tail.length > 0 ? tail : [0x11, 0x22, 0x33]),
    0xff, 0xd9, // EOI
  ]);
}

describe("prepareImages", () => {
  it("形式を見分け、付帯情報を落として返す", () => {
    const [prepared] = prepareImages([jpeg()]);
    assert.equal(prepared.mimeType, "image/jpeg");
    assert.ok(prepared.bytes.length < jpeg().length, "APP1が落ちていない");
  });

  it("0枚と上限超えを拒否する", () => {
    assert.throws(() => prepareImages([]), InventoryInputError);
    assert.throws(
      () => prepareImages(Array.from({ length: 6 }, () => jpeg())),
      (error: unknown) =>
        error instanceof InventoryInputError && error.message.includes("6枚が選ばれています"),
    );
  });

  it("上限ちょうどは通す", () => {
    assert.equal(prepareImages(Array.from({ length: 5 }, () => jpeg())).length, 5);
  });

  it("何枚目が駄目だったのかを伝える", () => {
    assert.throws(
      () => prepareImages([jpeg(), jpeg(), new Uint8Array([0x50, 0x4b, 0x03, 0x04])]),
      (error: unknown) =>
        error instanceof InventoryInputError && error.message.startsWith("3枚目"),
    );
  });

  it("HEICのときは、どうすればよいかが分かる文言で断る", () => {
    const heic = new Uint8Array([
      0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
    ]);
    assert.throws(
      () => prepareImages([heic]),
      (error: unknown) => error instanceof InventoryInputError && error.message.includes("互換性優先"),
    );
  });

  it("中身が空のファイルも拒否する", () => {
    assert.throws(() => prepareImages([new Uint8Array()]), InventoryInputError);
  });
});

describe("fingerprintImages", () => {
  const images = prepareImages([jpeg()]);

  it("同じ写真・同じ種類なら同じ指紋になる（画像再送の判定に使う）", () => {
    assert.equal(fingerprintImages(images, "SHELF"), fingerprintImages(images, "SHELF"));
  });

  it("同じ写真でも種類が違えば別の解析として扱う", () => {
    assert.notEqual(fingerprintImages(images, "SHELF"), fingerprintImages(images, "REMAINING"));
  });

  it("中身が違えば別の指紋になる", () => {
    const other = prepareImages([jpeg(0x99, 0x88, 0x77)]);
    assert.notEqual(fingerprintImages(images, "SHELF"), fingerprintImages(other, "SHELF"));
  });

  it("64文字のhexになる（DBの列に収まる）", () => {
    assert.match(fingerprintImages(images, "SHELF"), /^[0-9a-f]{64}$/);
  });
});
