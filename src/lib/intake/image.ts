/**
 * 受け取った画像の形式判定と、送る前の掃除（#10）。
 *
 * **形式はクライアントの申告（`File.type`）ではなく、中身の先頭バイトで決める。**
 * `Content-Type`は送信側が自由に書けるので、`image/jpeg`と名乗ったzipでも通ってしまう
 * （`docs/testing-strategy.md`の「画像アップロード制約の基準」）。
 *
 * **EXIFなどの付帯情報はモデルへ送る前に落とす。** iPhoneの写真には撮影場所の緯度経度が
 * 入っていることがあり、在庫の読み取りには要らない情報を外部へ渡すことになる。
 * ブラウザ側でcanvasへ描き直したものは付帯情報が消えているが、**JSが動かなかった場合は
 * 元の画像がそのまま届く**ので、サーバー側でも必ず落とす。
 *
 * ここにはPrismaもNext.jsも持ち込まない（DBの無いCIで判定そのものを試せるようにするため。
 * `image.test.ts`）。
 */

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

/**
 * 中身から形式を見分ける。判別できなければ`null`。
 *
 * HEIC（iPhoneの既定）はここでは受け付けない。**モデルのAPIが受け取れる形式が
 * JPEG・PNG・WebP・GIFに限られる**ためで、iPhoneから撮った場合はブラウザ側で
 * JPEGへ描き直してから送っている（`photo-upload-form.tsx`）。
 */
export function detectImageType(bytes: Uint8Array): ImageType | null {
  // JPEG: FF D8 FF
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // WebP: "RIFF" .... "WEBP"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }
  return null;
}

/**
 * 付帯情報（EXIF・XMP・コメント）を落とした画像を返す。
 *
 * **画素は触らない。** 再エンコードすると文字が潰れて読み取りに響くため、
 * 付帯情報のかたまりだけを取り除く。壊れていて読み解けない画像は、そのまま返す
 * （送るのを止めるほどではなく、モデル側が受け付けなければそこで失敗する）。
 */
export function stripMetadata(bytes: Uint8Array, type: ImageType): Uint8Array {
  switch (type) {
    case "image/jpeg":
      return stripJpegSegments(bytes);
    case "image/png":
      return stripPngChunks(bytes);
    case "image/webp":
      return stripWebpChunks(bytes);
  }
}

/**
 * JPEGのAPP1〜APP15とCOM（コメント）を落とす。
 *
 * APP0（JFIF）は解像度の宣言なので残す。EXIFはAPP1に入っており、GPSもそこにある。
 * 画像そのもの（SOS以降）には触らない。
 */
function stripJpegSegments(bytes: Uint8Array): Uint8Array {
  const keep: Uint8Array[] = [];
  let offset = 2; // SOI（FF D8）
  keep.push(bytes.subarray(0, 2));

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break; // マーカーが並んでいない＝読み解けない
    const marker = bytes[offset + 1];

    // SOS（FF DA）以降は画像データ本体。ここから先はそのまま通す。
    if (marker === 0xda) {
      keep.push(bytes.subarray(offset));
      return concat(keep);
    }

    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.length) break;

    const isAppExceptJfif = marker >= 0xe1 && marker <= 0xef;
    const isComment = marker === 0xfe;
    if (!isAppExceptJfif && !isComment) {
      keep.push(bytes.subarray(offset, offset + 2 + length));
    }
    offset += 2 + length;
  }

  // 途中で読み解けなくなったら、元の画像をそのまま使う（欠けたJPEGを作らない）。
  return bytes;
}

/** PNGの補助チャンク（eXIf・tEXt・iTXt・zTXt）を落とす。 */
function stripPngChunks(bytes: Uint8Array): Uint8Array {
  const drop = new Set(["eXIf", "tEXt", "iTXt", "zTXt"]);
  const keep: Uint8Array[] = [bytes.subarray(0, 8)];
  let offset = 8;

  while (offset + 8 <= bytes.length) {
    const length =
      (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 0 || offset + 12 + length > bytes.length) return bytes;

    const name = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (!drop.has(name)) keep.push(bytes.subarray(offset, offset + 12 + length));

    offset += 12 + length;
    if (name === "IEND") return concat(keep);
  }
  return bytes;
}

/** WebP（RIFF）のEXIF・XMPチャンクを落とす。 */
function stripWebpChunks(bytes: Uint8Array): Uint8Array {
  const drop = new Set(["EXIF", "XMP "]);
  const keep: Uint8Array[] = [bytes.subarray(0, 12)];
  let offset = 12;
  let dropped = false;

  while (offset + 8 <= bytes.length) {
    const size =
      bytes[offset + 4] |
      (bytes[offset + 5] << 8) |
      (bytes[offset + 6] << 16) |
      (bytes[offset + 7] << 24);
    if (size < 0) return bytes;
    // RIFFのチャンクは偶数バイトに揃える。
    const padded = size + (size % 2);
    if (offset + 8 + padded > bytes.length) return bytes;

    const name = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    if (drop.has(name)) dropped = true;
    else keep.push(bytes.subarray(offset, offset + 8 + padded));

    offset += 8 + padded;
  }

  if (!dropped) return bytes;

  const body = concat(keep);
  // RIFFのサイズ欄（先頭から4バイト目〜）を、削ったあとの長さで書き直す。
  const size = body.length - 8;
  body[4] = size & 0xff;
  body[5] = (size >> 8) & 0xff;
  body[6] = (size >> 16) & 0xff;
  body[7] = (size >> 24) & 0xff;
  return body;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
