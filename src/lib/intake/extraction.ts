/**
 * モデルが返したJSONを、DBへ渡してよい形へ検証・正規化する純関数（#10）。
 *
 * **モデルの出力をそのままDB操作へ使わない**（受入条件）。ここを通っていない値は
 * `service.ts`から書き込まない。構造化出力（`output_config.format`）を指定していても、
 * 返ってくるのは外部サービスの応答であって、こちらの型ではない。
 *
 * 方針は3つ。
 *
 * 1. **知らない欄は落とす。** 増えた欄をそのまま通すと、いつのまにかDBへ入る
 * 2. **壊れた値は`null`にして残りを活かす。** 1行が読めないだけで7件の候補を全部捨てない
 * 3. **`null`は「読めなかった」を意味する。** 0や空文字で埋めない（埋めると、受入条件の
 *    「読めなかった項目を表示する」を満たせなくなる）
 *
 * ここにはPrismaもNext.jsも持ち込まない（DBの無いCIで検証そのものを試せるようにするため。
 * `extraction.test.ts`）。
 */
import { EXPIRY_KINDS, type ExpiryKind } from "../inventory/operations.ts";
import { UNIT_DEFINITIONS, type UnitCode } from "../inventory/units.ts";

/**
 * プロンプトと出力形式の版。
 *
 * **同じ写真から違う読み方をするようになったら版を上げる**（#7のルール版と同じ約束）。
 * 文言の手直しや並び順だけの変更では上げない。
 */
export const INTAKE_PROMPT_VERSION = "v1";

/** 1回の抽出で受け付ける候補の上限。これを超えたぶんは捨てる（暴走した応答への歯止め）。 */
export const INTAKE_ITEM_LIMIT = 40;

const MAX_NAME_LENGTH = 120;
const MAX_EVIDENCE_LENGTH = 500;

/** 欄ごとの確からしさ（0〜1）。読めなかった欄は`null`。 */
export interface ExtractedFieldConfidence {
  readonly productName: number | null;
  readonly amount: number | null;
  readonly expiry: number | null;
  readonly category: number | null;
  readonly storage: number | null;
}

/** 検証を通した候補1件。値はすべて「そのままDBへ入れてよい」形になっている。 */
export interface ExtractedItem {
  /** 何枚目の画像から読んだか（0始まり）。分からなければ`null`。 */
  readonly imageIndex: number | null;
  /** 在庫にしないもの（レジ袋・値引き行・小計など）としてモデルが印を付けたか。 */
  readonly ignore: boolean;
  readonly productName: string | null;
  readonly brand: string | null;
  readonly categoryName: string | null;
  /** 数量。`Decimal`へ渡せる十進の文字列か`null`。 */
  readonly amount: string | null;
  readonly unit: UnitCode | null;
  readonly expiryKind: ExpiryKind;
  /** `YYYY-MM-DD`。`expiryKind`が日付を持つ種別のときだけ値が入る。 */
  readonly expiryDate: string | null;
  /** 写真から読んだ置き場所の呼び名。既存の保管場所への当てはめは`service.ts`が行う。 */
  readonly storageName: string | null;
  /** 抽出の根拠（レシートの行そのものなど）。 */
  readonly evidence: string | null;
  readonly confidence: number | null;
  readonly fieldConfidence: ExtractedFieldConfidence;
}

/** 応答そのものが読めなかったときに投げる。1件も候補を作れないので、取り込みは失敗にする。 */
export class ExtractionFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionFormatError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 文字列として読み、前後の空白を落として長さで切る。空になったら`null`。 */
function readText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, maxLength).trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * 数量を読む。
 *
 * 全角数字・桁区切りのカンマは、モデルがレシートの表記をそのまま写してくることがあるので
 * 受け付けて正規化する（`parseAmount()`と同じ扱い）。0以下と小数4桁以上は`null`にする
 * （DBが`Decimal(14, 3)`のため、丸めて入れると数量が黙って変わる）。
 */
export function readAmount(value: unknown): string | null {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
  const normalized = raw
    .trim()
    .replace(/[０-９．]/g, (char) =>
      char === "．" ? "." : String.fromCharCode(char.charCodeAt(0) - 0xfee0),
    )
    .replace(/,/g, "");
  if (!/^\d{1,11}(\.\d{1,3})?$/.test(normalized)) return null;
  if (Number(normalized) <= 0) return null;
  return normalized;
}

function readUnit(value: unknown): UnitCode | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return code in UNIT_DEFINITIONS ? (code as UnitCode) : null;
}

/**
 * `YYYY-MM-DD`として読む。**暦として存在しない日付は`null`**（`2026-02-30`など）。
 *
 * `Date`へ通したうえで元の文字列と一致するかを見る。JavaScriptの`Date`は2月30日を3月2日へ
 * 繰り上げて受け付けてしまうため、通っただけでは確かめたことにならない。
 */
export function readDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (date.toISOString().slice(0, 10) !== text) return null;
  // 明らかに読み違えた年（1990年より前・2100年より後）は捨てる。
  const year = date.getUTCFullYear();
  if (year < 1990 || year > 2100) return null;
  return text;
}

/** 0〜1に収まる数だけを採る。範囲外・数でないものは`null`。 */
export function readConfidence(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > 1) return null;
  return Math.round(value * 1000) / 1000;
}

function readExpiryKind(value: unknown): ExpiryKind {
  if (typeof value !== "string") return "UNKNOWN";
  const found = EXPIRY_KINDS.find((kind) => kind === value.trim().toUpperCase());
  return found ?? "UNKNOWN";
}

function readImageIndex(value: unknown, imageCount: number): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < 0 || value >= imageCount) return null;
  return value;
}

function readItem(raw: unknown, imageCount: number): ExtractedItem | null {
  if (!isRecord(raw)) return null;

  const expiryDate = readDate(raw.expiryDate);
  let expiryKind = readExpiryKind(raw.expiryKind);
  // 日付を持つ種別なのに日付が読めていない組み合わせは作らない。
  // そのまま通すと、登録のときに「期限の日付を入力してください」で必ず弾かれる候補になる。
  if ((expiryKind === "BEST_BEFORE" || expiryKind === "USE_BY") && !expiryDate) {
    expiryKind = "UNKNOWN";
  }

  const item: ExtractedItem = {
    imageIndex: readImageIndex(raw.imageIndex, imageCount),
    ignore: raw.ignore === true,
    productName: readText(raw.productName, MAX_NAME_LENGTH),
    brand: readText(raw.brand, MAX_NAME_LENGTH),
    categoryName: readText(raw.categoryName, MAX_NAME_LENGTH),
    amount: readAmount(raw.amount),
    unit: readUnit(raw.unit),
    expiryKind,
    expiryDate: expiryKind === "UNKNOWN" || expiryKind === "NONE" ? null : expiryDate,
    storageName: readText(raw.storageName, MAX_NAME_LENGTH),
    evidence: readText(raw.evidence, MAX_EVIDENCE_LENGTH),
    confidence: readConfidence(raw.confidence),
    fieldConfidence: readFieldConfidence(raw.fieldConfidence),
  };

  // 商品名・数量・期限のどれも読めなかった行は、画面に出しても直しようがないので捨てる。
  if (!item.productName && !item.amount && !item.expiryDate) return null;
  return item;
}

function readFieldConfidence(raw: unknown): ExtractedFieldConfidence {
  const source = isRecord(raw) ? raw : {};
  return {
    productName: readConfidence(source.productName),
    amount: readConfidence(source.amount),
    expiry: readConfidence(source.expiry),
    category: readConfidence(source.category),
    storage: readConfidence(source.storage),
  };
}

/**
 * モデルの応答を候補の配列にする。
 *
 * `items`が配列で来ていなければ`ExtractionFormatError`。それ以外は、読めた行だけを返す
 * （**1行の壊れが全体を落とさない**）。0件で返ることもあり、そのときは「読み取れなかった」
 * として画面に出す。
 */
export function parseExtraction(raw: unknown, options: { imageCount: number }): ExtractedItem[] {
  if (!isRecord(raw)) {
    throw new ExtractionFormatError("応答がJSONのオブジェクトではありませんでした。");
  }
  if (!Array.isArray(raw.items)) {
    throw new ExtractionFormatError("応答に候補の一覧（items）が含まれていませんでした。");
  }

  const items: ExtractedItem[] = [];
  for (const entry of raw.items.slice(0, INTAKE_ITEM_LIMIT)) {
    const item = readItem(entry, Math.max(1, options.imageCount));
    if (item) items.push(item);
  }
  return items;
}
