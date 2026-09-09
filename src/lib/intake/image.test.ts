import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { detectImageType, stripMetadata } from "./image.ts";

const JPEG_SOI = [0xff, 0xd8];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

/** `FF <marker> <長さ2バイト> <中身>` のJPEGセグメント。 */
function jpegSegment(marker: number, body: readonly number[]): number[] {
  const length = body.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...body];
}

/** `<長さ4バイト> <名前4バイト> <中身> <CRC4バイト>` のPNGチャンク。 */
function pngChunk(name: string, body: readonly number[]): number[] {
  const length = body.length;
  return [
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
    ...[...name].map((char) => char.charCodeAt(0)),
    ...body,
    0, 0, 0, 0,
  ];
}

/** `<名前4バイト> <長さ4バイト(LE)> <中身>` のRIFFチャンク。 */
function riffChunk(name: string, body: readonly number[]): number[] {
  const size = body.length;
  const padded = size % 2 === 1 ? [...body, 0] : [...body];
  return [
    ...[...name].map((char) => char.charCodeAt(0)),
    size & 0xff,
    (size >>> 8) & 0xff,
    (size >>> 16) & 0xff,
    (size >>> 24) & 0xff,
    ...padded,
  ];
}

describe("detectImageType", () => {
  it("中身の先頭バイトで形式を決める", () => {
    assert.equal(detectImageType(bytes(0xff, 0xd8, 0xff, 0xe0)), "image/jpeg");
    assert.equal(detectImageType(bytes(...PNG_SIGNATURE, 0, 0)), "image/png");
    assert.equal(
      detectImageType(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50)),
      "image/webp",
    );
  });

  it("画像でないものはnull（申告されたContent-Typeを当てにしない）", () => {
    // ZIP（PK\x03\x04）。`image/jpeg`と名乗って送られてもここで止まる。
    assert.equal(detectImageType(bytes(0x50, 0x4b, 0x03, 0x04, 0, 0)), null);
    assert.equal(detectImageType(bytes(0x00)), null);
    assert.equal(detectImageType(new Uint8Array(0)), null);
  });

  it("HEICは受け付けない（モデルのAPIが受け取れないため）", () => {
    // ftypheic のボックス。先頭4バイトはサイズで、画像の署名にはあたらない。
    const heic = bytes(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63);
    assert.equal(detectImageType(heic), null);
  });

  it("RIFFでもWEBPでなければnull（WAVなど）", () => {
    const wav = bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45);
    assert.equal(detectImageType(wav), null);
  });
});

describe("stripMetadata: JPEG", () => {
  it("EXIF（APP1）とコメントを落とし、画像本体は残す", () => {
    const exif = jpegSegment(0xe1, [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x99, 0x99]);
    const comment = jpegSegment(0xfe, [0x41]);
    const quantization = jpegSegment(0xdb, [0x01, 0x02]);
    const scan = [0xff, 0xda, 0x00, 0x03, 0xaa, 0xbb, 0xcc];
    const input = bytes(...JPEG_SOI, ...exif, ...comment, ...quantization, ...scan);

    const output = stripMetadata(input, "image/jpeg");
    const expected = bytes(...JPEG_SOI, ...quantization, ...scan);
    assert.deepEqual([...output], [...expected]);
  });

  it("APP0（JFIF）は残す（解像度の宣言なので落とすと縦横比が変わりうる）", () => {
    const jfif = jpegSegment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00]);
    const scan = [0xff, 0xda, 0x00, 0x02];
    const input = bytes(...JPEG_SOI, ...jfif, ...scan);
    assert.deepEqual([...stripMetadata(input, "image/jpeg")], [...input]);
  });

  it("画像データ本体（SOS以降）には触らない", () => {
    // SOSより後ろにEXIFらしきバイト列があっても、それは画素なので消さない。
    const scan = [0xff, 0xda, 0x00, 0x02, 0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66];
    const input = bytes(...JPEG_SOI, ...scan);
    assert.deepEqual([...stripMetadata(input, "image/jpeg")], [...input]);
  });

  it("読み解けない並びは元のまま返す（欠けた画像を作らない）", () => {
    const broken = bytes(...JPEG_SOI, 0x12, 0x34, 0x56);
    assert.deepEqual([...stripMetadata(broken, "image/jpeg")], [...broken]);
  });
});

describe("stripMetadata: PNG", () => {
  it("eXIf・tEXtを落とし、画素のチャンクは残す", () => {
    const ihdr = pngChunk("IHDR", [1, 2, 3]);
    const exif = pngChunk("eXIf", [0x99, 0x99]);
    const text = pngChunk("tEXt", [0x41]);
    const idat = pngChunk("IDAT", [4, 5, 6]);
    const iend = pngChunk("IEND", []);
    const input = bytes(...PNG_SIGNATURE, ...ihdr, ...exif, ...text, ...idat, ...iend);

    const output = stripMetadata(input, "image/png");
    assert.deepEqual([...output], [...bytes(...PNG_SIGNATURE, ...ihdr, ...idat, ...iend)]);
  });

  it("落とすものが無ければ内容は変わらない", () => {
    const input = bytes(...PNG_SIGNATURE, ...pngChunk("IHDR", [1]), ...pngChunk("IEND", []));
    assert.deepEqual([...stripMetadata(input, "image/png")], [...input]);
  });
});

describe("stripMetadata: WebP", () => {
  it("EXIF・XMPのチャンクを落とし、RIFFの長さを書き直す", () => {
    const vp8 = riffChunk("VP8 ", [1, 2, 3, 4]);
    const exif = riffChunk("EXIF", [0x99, 0x99, 0x99, 0x99]);
    const header = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
    const input = bytes(...header, ...vp8, ...exif);

    const output = stripMetadata(input, "image/webp");
    assert.equal(output.length, 12 + vp8.length);
    // RIFFのサイズ欄は「先頭8バイトを除いた長さ」。
    const size = output[4] | (output[5] << 8) | (output[6] << 16) | (output[7] << 24);
    assert.equal(size, output.length - 8);
    assert.equal(String.fromCharCode(...output.subarray(12, 16)), "VP8 ");
  });

  it("落とすものが無ければ元のまま返す（サイズ欄を書き換えない）", () => {
    const header = [0x52, 0x49, 0x46, 0x46, 12, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
    const input = bytes(...header, ...riffChunk("VP8 ", [1, 2, 3, 4]));
    assert.deepEqual([...stripMetadata(input, "image/webp")], [...input]);
  });
});
