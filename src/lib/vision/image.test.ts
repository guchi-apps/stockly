import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { InventoryInputError } from "../inventory/operations.ts";
import {
  assertImageCount,
  detectMediaType,
  fingerprintImages,
  looksLikeHeif,
  prepareImage,
  stripMetadata,
} from "./image.ts";

/**
 * 画像の受け入れ検査（#11）。`docs/testing-strategy.md`の「画像アップロード制約の基準」に対応する。
 *
 * **モデルAPIには接続しない。** ここで確かめるのは形式の判定・上限の境目・位置情報の除去で、
 * どれも送る前に効いていなければ意味がない。
 */

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

/** 最小限のJPEG: SOI + APP1(Exif) + APP0(JFIF) + SOS + データ + EOI。 */
function jpegWithExif(): Uint8Array {
  return bytes(
    0xff, 0xd8, // SOI
    0xff, 0xe1, 0x00, 0x06, 0x45, 0x78, 0x69, 0x66, // APP1 "Exif"（長さは自身の2バイトを含む＝6）
    0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, // APP0 JFIF（残る）
    0xff, 0xda, 0x00, 0x03, 0x01, // SOS
    0x11, 0x22, 0x33, // 画像データ
    0xff, 0xd9, // EOI
  );
}

function pngWith(chunkType: string): Uint8Array {
  const type = [...chunkType].map((char) => char.charCodeAt(0));
  return bytes(
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
    0x00, 0x00, 0x00, 0x01, ...type, 0x41, 0x00, 0x00, 0x00, 0x00, // 対象のチャンク（データ1バイト）
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0x00, 0x00, 0x00, 0x00, // IEND
  );
}

describe("detectMediaType", () => {
  it("マジックバイトからJPEG・PNG・WebPを見分ける", () => {
    assert.equal(detectMediaType(bytes(0xff, 0xd8, 0xff, 0xe0)), "image/jpeg");
    assert.equal(
      detectMediaType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)),
      "image/png",
    );
    assert.equal(
      detectMediaType(
        bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50),
      ),
      "image/webp",
    );
  });

  it("画像でないものは拒否する（申告されたContent-Typeは見ない）", () => {
    assert.equal(detectMediaType(bytes(0x50, 0x4b, 0x03, 0x04)), null); // zip
    assert.equal(detectMediaType(bytes()), null);
  });

  it("HEICは受け付けないが、それと分かるようにする", () => {
    const heic = bytes(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63);
    assert.equal(detectMediaType(heic), null);
    assert.equal(looksLikeHeif(heic), true);
  });
});

describe("assertImageCount", () => {
  it("0枚と上限超えを拒否する", () => {
    assert.throws(() => assertImageCount(0, 4), InventoryInputError);
    assert.throws(() => assertImageCount(5, 4), InventoryInputError);
  });

  it("上限ちょうどは通す", () => {
    assert.doesNotThrow(() => assertImageCount(4, 4));
  });
});

describe("prepareImage", () => {
  it("上限ちょうどは通し、1バイト超えたら拒否する", () => {
    const jpeg = jpegWithExif();
    assert.doesNotThrow(() => prepareImage(jpeg, { maxBytes: jpeg.length, index: 0 }));
    assert.throws(
      () => prepareImage(jpeg, { maxBytes: jpeg.length - 1, index: 0 }),
      InventoryInputError,
    );
  });

  it("HEICは、どうすればよいかが分かる文言で断る", () => {
    const heic = bytes(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63);
    assert.throws(
      () => prepareImage(heic, { maxBytes: 1000, index: 0 }),
      (error: unknown) =>
        error instanceof InventoryInputError && error.message.includes("HEIC"),
    );
  });

  it("何枚目かが分かるメッセージにする", () => {
    assert.throws(
      () => prepareImage(bytes(0x50, 0x4b), { maxBytes: 1000, index: 2 }),
      (error: unknown) => error instanceof InventoryInputError && error.message.startsWith("3枚目"),
    );
  });

  it("通した画像からは付随情報が落ちている", () => {
    const prepared = prepareImage(jpegWithExif(), { maxBytes: 1000, index: 0 });
    assert.equal(prepared.mediaType, "image/jpeg");
    assert.ok(prepared.bytes.length < jpegWithExif().length);
  });
});

describe("stripMetadata", () => {
  it("JPEGのAPP1（Exif・GPS）を落とし、APP0と画像データは残す", () => {
    const stripped = stripMetadata(jpegWithExif(), "image/jpeg");
    // APP1のマーカー(0xFFE1)が消えていること。
    assert.equal(hasMarker(stripped, 0xe1), false);
    // APP0とSOSは残っていること。
    assert.equal(hasMarker(stripped, 0xe0), true);
    assert.equal(hasMarker(stripped, 0xda), true);
  });

  it("PNGのeXIfチャンクを落とす", () => {
    const withExif = pngWith("eXIf");
    const stripped = stripMetadata(withExif, "image/png");
    assert.ok(stripped.length < withExif.length);
    assert.equal(new TextDecoder().decode(stripped).includes("eXIf"), false);
  });

  it("画素に関わるチャンクは残す", () => {
    const withIhdr = pngWith("IHDR");
    assert.equal(stripMetadata(withIhdr, "image/png").length, withIhdr.length);
  });

  it("壊れた並びのファイルは切り詰めず、そのまま返す", () => {
    const broken = bytes(0xff, 0xd8, 0x00, 0x01, 0x02);
    assert.deepEqual(stripMetadata(broken, "image/jpeg"), broken);
  });
});

describe("fingerprintImages", () => {
  const jpeg = { mediaType: "image/jpeg" as const, bytes: jpegWithExif() };

  it("同じ画像・同じ種類なら同じ指紋になる（画像再送の判定に使う）", async () => {
    assert.equal(
      await fingerprintImages([jpeg], "SHELF"),
      await fingerprintImages([jpeg], "SHELF"),
    );
  });

  it("同じ画像でも種類が違えば別の解析として扱う", async () => {
    assert.notEqual(
      await fingerprintImages([jpeg], "SHELF"),
      await fingerprintImages([jpeg], "REMAINING"),
    );
  });

  it("64文字のhexになる", async () => {
    assert.match(await fingerprintImages([jpeg], "SHELF"), /^[0-9a-f]{64}$/);
  });
});

/** `0xFF <marker>` の並びがあるか。SOS以降のデータは見ない。 */
function hasMarker(data: Uint8Array, marker: number): boolean {
  for (let i = 0; i + 1 < data.length; i += 1) {
    if (data[i] === 0xff && data[i + 1] === marker) return true;
  }
  return false;
}
