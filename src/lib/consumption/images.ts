/**
 * 送る写真の受け入れ検査と指紋（#11）。
 *
 * **形式の判定とEXIF除去そのものは`src/lib/intake/image.ts`（#10）を使う。** ここが足すのは
 * #11固有の2つだけ。
 *
 * 1. **何枚目が駄目だったのかが分かる断り方**（一度に複数枚送るため、「読み取れません」だけでは
 *    どれを撮り直せばよいか分からない）
 * 2. **画像の指紋**。#11は写真を保存しないので、同じ写真を送り直したことを見分ける手がかりが
 *    これしかない（`ConsumptionScan`の`@@unique([householdId, imageFingerprint])`）
 *
 * PrismaもNext.jsも持ち込まない（DBの無いCIで上限と指紋を試せるようにするため。`images.test.ts`）。
 */
import { createHash } from "node:crypto";

import { MAX_IMAGES_PER_BATCH, MAX_IMAGE_BYTES } from "../intake/config.ts";
import { detectImageType, stripMetadata, type ImageType } from "../intake/image.ts";
import { InventoryInputError } from "../inventory/operations.ts";
import type { ConsumptionScanKind } from "./kinds.ts";

export interface PreparedImage {
  readonly mimeType: ImageType;
  /** 付帯情報（EXIF・GPS）を落としたあとのバイト列。 */
  readonly bytes: Uint8Array;
}

/**
 * 送る前に弾く入力。**枚数・大きさ・形式の基準は#10と同じものを使う。**
 *
 * **1枚でも駄目なら読み取りそのものを止める。** 一部だけ黙って捨てると、写したはずのものが
 * 候補に出ない理由が利用者に分からない。
 */
export function prepareImages(images: readonly Uint8Array[]): PreparedImage[] {
  if (images.length === 0) {
    throw new InventoryInputError("images", "写真を1枚以上選んでください。");
  }
  if (images.length > MAX_IMAGES_PER_BATCH) {
    throw new InventoryInputError(
      "images",
      `写真は1回に${MAX_IMAGES_PER_BATCH}枚までです（${images.length}枚が選ばれています）。`,
    );
  }

  return images.map((bytes, index) => {
    const label = `${index + 1}枚目`;
    if (bytes.byteLength === 0) {
      throw new InventoryInputError("images", `${label}の写真を読み取れませんでした。`);
    }
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new InventoryInputError("images", `${label}の写真が大きすぎます（1枚10MBまで）。`);
    }

    const mimeType = detectImageType(bytes);
    if (!mimeType) {
      throw new InventoryInputError(
        "images",
        `${label}は写真として読み取れませんでした。iPhoneのHEICはこの画面が自動でJPEGへ変換しますが、` +
          "変換できなかった場合は「設定 → カメラ → フォーマット」を「互換性優先」にしてください。",
      );
    }
    return { mimeType, bytes: stripMetadata(bytes, mimeType) };
  });
}

/**
 * 送る画像の指紋（SHA-256のhex、64文字）。
 *
 * **画像そのものを保存しない代わりに、これだけを残す。** 同じ写真を送り直したときに
 * 前回の候補をそのまま返すために使う。
 *
 * 撮影の種類も混ぜる。同じ写真でも種類が違えば減らす量の出し方が変わるため、
 * 「別の解析」として扱う必要がある。
 */
export function fingerprintImages(
  images: readonly PreparedImage[],
  kind: ConsumptionScanKind,
): string {
  const hash = createHash("sha256").update(`${kind}\n`);
  for (const image of images) hash.update(image.bytes);
  return hash.digest("hex");
}
