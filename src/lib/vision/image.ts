/**
 * モデルへ送る画像の受け入れ検査と後始末（#11。購入写真AI #10 と共通で使う）。
 *
 * 基準は`docs/testing-strategy.md`「画像アップロード制約の基準」。ここで守るのは4つ。
 *
 * 1. **形式はクライアントの申告ではなく、こちらでマジックバイトを見て決める。**
 *    `Content-Type`は誰でも書き換えられるので、`image/jpeg`と名乗るzipを送れてしまう
 * 2. **1枚あたりのバイト数と、1回あたりの枚数に上限を置く**（費用と時間の歯止め）
 * 3. **位置情報（EXIF GPS）はモデルへ送る前に落とす。** 家の中を撮った写真には、
 *    撮影地＝自宅の座標がそのまま入っている
 * 4. **画像そのものは保存しない。** 残すのは同じ画像かどうかを見分けるための指紋だけ
 *
 * HEIC（iPhoneの既定）は**ここで受け取らない**。EXIFを外すにはHEIFのボックスを解く必要があり、
 * そのための依存を増やしたくないため。ブラウザ側でJPEGへ変換してから送る
 * （canvasへ描き直した時点でメタデータは落ちるので、変換そのものがEXIF除去にもなる）。
 */
// テスト（`node --test`）から読むモジュールなので、`@/`エイリアスではなく相対パス＋拡張子で書く
// （Nodeはtsconfigのpathsを解決しない。`docs/testing-strategy.md`）。
import { InventoryInputError } from "../inventory/operations.ts";

/** 受け付ける形式。**この3つ以外は拒否する**（HEICを含む）。 */
export const ACCEPTED_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AcceptedMediaType = (typeof ACCEPTED_MEDIA_TYPES)[number];

/** 画面の`accept`属性に出す値。HEICは`image/*`に含まれるため、明示的に並べる。 */
export const ACCEPT_ATTRIBUTE = ACCEPTED_MEDIA_TYPES.join(",");

export interface PreparedImage {
  readonly mediaType: AcceptedMediaType;
  /** 位置情報などを落としたあとのバイト列。 */
  readonly bytes: Uint8Array;
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(bytes[offset + i] ?? 0);
  return out;
}

/**
 * 先頭のバイト列から形式を判定する。判定できなければ`null`。
 *
 * **拡張子もContent-Typeも見ない。** ここが「申告を信じない」ことの実体。
 */
export function detectMediaType(bytes: Uint8Array): AcceptedMediaType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && ascii(bytes, 8, 4) === "WEBP") {
    return "image/webp";
  }
  return null;
}

/** HEIC/HEIFかどうか。拒否の理由を「対応していない形式」ではなく具体的に伝えるためだけに見る。 */
export function looksLikeHeif(bytes: Uint8Array): boolean {
  if (bytes.length < 12 || ascii(bytes, 4, 4) !== "ftyp") return false;
  const brand = ascii(bytes, 8, 4);
  return ["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1"].includes(brand);
}

/**
 * 1枚を受け入れてよいか確かめ、位置情報を落としたバイト列にして返す。
 *
 * 拒否は例外（`InventoryInputError`）で返す。**枚数のうち1枚でも駄目なら解析そのものを止める**
 * ——一部だけ黙って捨てると、写したはずのものが候補に出ない理由が利用者に分からない。
 */
export function prepareImage(
  bytes: Uint8Array,
  options: { maxBytes: number; index: number },
): PreparedImage {
  const label = `${options.index + 1}枚目`;

  if (bytes.length === 0) {
    throw new InventoryInputError("images", `${label}の写真を読み取れませんでした。`);
  }
  if (bytes.length > options.maxBytes) {
    const limitMb = Math.floor(options.maxBytes / (1024 * 1024));
    throw new InventoryInputError(
      "images",
      `${label}の写真が大きすぎます（1枚${limitMb}MBまで）。`,
    );
  }

  const mediaType = detectMediaType(bytes);
  if (!mediaType) {
    throw new InventoryInputError(
      "images",
      looksLikeHeif(bytes)
        ? `${label}はHEIC形式です。iPhoneの「設定 → カメラ → フォーマット」を「互換性優先」にするか、JPEGで保存し直して送ってください。`
        : `${label}は写真として読み取れませんでした。JPEG・PNG・WebPのいずれかを選んでください。`,
    );
  }

  return { mediaType, bytes: stripMetadata(bytes, mediaType) };
}

/** 枚数の上限。0枚も拒否する（送るものが無いのに課金される呼び出しを作らない）。 */
export function assertImageCount(count: number, maxImages: number): void {
  if (count === 0) {
    throw new InventoryInputError("images", "写真を1枚以上選んでください。");
  }
  if (count > maxImages) {
    throw new InventoryInputError(
      "images",
      `写真は一度に${maxImages}枚までです（${count}枚が選ばれています）。`,
    );
  }
}

// ---------------------------------------------------------------------------
// 位置情報・付随情報の除去
// ---------------------------------------------------------------------------

/**
 * 形式ごとに、画素以外の付随情報を落とす。
 *
 * **落とせなかった場合は元のバイト列をそのまま返さない**——のではなく、返す。
 * 壊れた（あるいは想定外の並びの）ファイルを無理に切り詰めると、画素まで壊して
 * 「読めない写真」になる。ここで通っても、形式の判定は`detectMediaType()`で済んでいる。
 */
export function stripMetadata(bytes: Uint8Array, mediaType: AcceptedMediaType): Uint8Array {
  if (mediaType === "image/jpeg") return stripJpegMetadata(bytes);
  if (mediaType === "image/png") return stripPngMetadata(bytes);
  return stripWebpMetadata(bytes);
}

/**
 * JPEGからAPP1〜APP15とコメントを落とす。
 *
 * EXIF（GPSを含む）はAPP1、XMPもAPP1、Photoshopの情報はAPP13にある。APP0（JFIF）は
 * 画素の解釈に関わるので残す。SOS（画像データの開始）以降はそのまま写す。
 */
function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (!startsWith(bytes, [0xff, 0xd8])) return bytes;

  const kept: Uint8Array[] = [bytes.subarray(0, 2)];
  let i = 2;

  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) return bytes; // 想定外の並び。触らずに返す。
    // マーカーの前には0xFFの詰め物が並ぶことがある。
    if (bytes[i + 1] === 0xff) {
      i += 1;
      continue;
    }

    const marker = bytes[i + 1];

    // 長さを持たないマーカー。
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      kept.push(bytes.subarray(i, i + 2));
      i += 2;
      continue;
    }
    // SOS以降は画像データなので、残り全部をそのまま写す。
    if (marker === 0xda) {
      kept.push(bytes.subarray(i));
      i = bytes.length;
      break;
    }
    if (marker === 0xd9) {
      kept.push(bytes.subarray(i, i + 2));
      i += 2;
      break;
    }

    if (i + 3 >= bytes.length) return bytes;
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2 || i + 2 + length > bytes.length) return bytes;

    const isAppExceptJfif = marker >= 0xe1 && marker <= 0xef;
    const isComment = marker === 0xfe;
    if (!isAppExceptJfif && !isComment) {
      kept.push(bytes.subarray(i, i + 2 + length));
    }
    i += 2 + length;
  }

  return concat(kept);
}

/** PNGからテキスト・EXIF・時刻のチャンクを落とす。 */
function stripPngMetadata(bytes: Uint8Array): Uint8Array {
  const DROP = new Set(["eXIf", "tEXt", "iTXt", "zTXt", "tIME"]);
  const kept: Uint8Array[] = [bytes.subarray(0, 8)];
  let i = 8;

  while (i + 8 <= bytes.length) {
    const length = readUint32BE(bytes, i);
    const type = ascii(bytes, i + 4, 4);
    const end = i + 12 + length; // 長さ(4) + 型(4) + データ + CRC(4)
    if (end > bytes.length) return bytes;

    if (!DROP.has(type)) kept.push(bytes.subarray(i, end));
    i = end;
    if (type === "IEND") break;
  }

  return concat(kept);
}

/** WebP（RIFF）からEXIF・XMPのチャンクを落とし、RIFFの長さを直す。 */
function stripWebpMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 12) return bytes;

  const DROP = new Set(["EXIF", "XMP "]);
  const kept: Uint8Array[] = [];
  let i = 12;
  let dropped = false;

  while (i + 8 <= bytes.length) {
    const size = readUint32LE(bytes, i + 4);
    const padded = size + (size % 2); // チャンクは偶数バイト境界に揃える
    const end = i + 8 + padded;
    if (end > bytes.length) return bytes;

    if (DROP.has(ascii(bytes, i, 4))) {
      dropped = true;
    } else {
      kept.push(bytes.subarray(i, end));
    }
    i = end;
  }

  if (!dropped) return bytes;

  const payload = concat(kept);
  const header = new Uint8Array(12);
  header.set(bytes.subarray(0, 12));
  writeUint32LE(header, 4, payload.length + 4); // "WEBP"の4バイトを含む
  return concat([header, payload]);
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) >>> 0) +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] +
    (bytes[offset + 1] << 8) +
    (bytes[offset + 2] << 16) +
    ((bytes[offset + 3] << 24) >>> 0)
  );
}

function writeUint32LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
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

// ---------------------------------------------------------------------------
// 指紋
// ---------------------------------------------------------------------------

/**
 * 送る画像の指紋（SHA-256のhex、64文字）。
 *
 * **画像そのものを保存しない代わりに、これだけを残す。** 同じ写真を送り直したときに
 * 前回の候補をそのまま返すために使う（`ConsumptionScan`の`@@unique([householdId, imageFingerprint])`）。
 *
 * 撮影の種類（空き容器・残量・棚）も混ぜる。同じ写真でも種類が違えば減らす量の出し方が変わるため、
 * 「別の解析」として扱う必要がある。
 */
export async function fingerprintImages(
  images: readonly PreparedImage[],
  kind: string,
): Promise<string> {
  const parts = [new TextEncoder().encode(`${kind}\n`), ...images.map((image) => image.bytes)];
  const digest = await crypto.subtle.digest("SHA-256", concat(parts) as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** モデルへ送るためのbase64。 */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000; // 一度に渡す長さ。大きすぎるとスタックがあふれる。
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
