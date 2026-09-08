/**
 * バーコードの値そのものを扱う純関数（#9）。
 *
 * ここにはPrismaもNext.jsも持ち込まない。読み取り画面（クライアント）と
 * Server Actionの両方が同じ規則で値を正すために、依存の無い形にしてある。
 *
 * **正規化と検証を必ず通してからDBへ渡す。** バーコードは家庭内で一意（`@@unique([householdId, code])`）
 * なので、全角の`４`と半角の`4`、ハイフン入りと無しが別の行になると、同じ商品に2つの紐付けができる。
 */
import { InventoryInputError } from "../inventory/operations.ts";

/** DBの`BarcodeSymbology`と同じ並び。`enum`にしないのはNodeのstrip-onlyモードで落ちるため。 */
export const BARCODE_SYMBOLOGIES = [
  "JAN",
  "EAN13",
  "EAN8",
  "UPC_A",
  "CODE128",
  "QR",
  "OTHER",
] as const;

export type BarcodeSymbology = (typeof BARCODE_SYMBOLOGIES)[number];

export const BARCODE_SYMBOLOGY_LABELS: Readonly<Record<BarcodeSymbology, string>> = {
  JAN: "JAN",
  EAN13: "EAN-13",
  EAN8: "EAN-8",
  UPC_A: "UPC-A",
  CODE128: "CODE128",
  QR: "QR",
  OTHER: "その他",
};

/** コードの最大長。CODE128やQRは可変長なので、DBの`VARCHAR(191)`に収まる範囲で切る。 */
const MAX_CODE_LENGTH = 64;

/**
 * 入力されたコードを正規化する。
 *
 * 全角数字・桁区切りのハイフン・空白はスマホの入力とレシートの転記で混ざりやすいので、
 * ここで落としてから比べる。数字以外の記号を含むコード（CODE128）もありうるため、
 * 英数字と一部の記号は残す。
 */
export function normalizeBarcode(raw: string | undefined | null): string {
  return (raw ?? "")
    .trim()
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[\s\-‐‑–—ー_]/g, "")
    .toUpperCase();
}

/**
 * EAN-13・EAN-8・UPC-Aのチェックディジットが合っているか。
 *
 * 末尾1桁は残りの桁から決まるため、手入力の打ち間違いはここでほぼ捕まる。
 * **桁数が対象外のコード（CODE128・QRなど）は検証しない**ので`true`を返す。
 */
export function hasValidCheckDigit(code: string): boolean {
  if (!/^\d+$/.test(code)) return true;
  if (code.length !== 8 && code.length !== 12 && code.length !== 13) return true;

  const digits = [...code].map(Number);
  const check = digits.pop() as number;

  // 右端（チェックディジットの1つ左）から3, 1, 3, 1… の重みを掛ける。
  // 桁数が違っても右から数えれば同じ規則になるので、EAN-8とEAN-13を分けなくてよい。
  const sum = digits
    .reverse()
    .reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);

  return (10 - (sum % 10)) % 10 === check;
}

/**
 * 桁数と接頭辞からシンボロジーを推定する。
 *
 * 45・49で始まる13桁は日本の事業者に割り当てられたJANなので、EAN-13と区別して記録する
 * （見た目の区別だけで、扱いは同じ）。
 */
export function detectSymbology(code: string): BarcodeSymbology {
  if (!/^\d+$/.test(code)) return code.length > 20 ? "QR" : "CODE128";
  if (code.length === 13) return /^(45|49)/.test(code) ? "JAN" : "EAN13";
  if (code.length === 8) return "EAN8";
  if (code.length === 12) return "UPC_A";
  return "OTHER";
}

/**
 * `BarcodeDetector`が返す形式名を、DBのシンボロジーへ移す。
 *
 * 標準実装とponyfillで同じ文字列（`ean_13`など）が返る。知らない形式はOTHERにして、
 * 読めたこと自体は活かす（記録の形式名より、コードの値のほうが大事）。
 */
export function symbologyFromDetectedFormat(format: string, code: string): BarcodeSymbology {
  switch (format) {
    case "ean_13":
      return detectSymbology(code) === "JAN" ? "JAN" : "EAN13";
    case "ean_8":
      return "EAN8";
    case "upc_a":
      return "UPC_A";
    case "upc_e":
      return "UPC_A";
    case "code_128":
      return "CODE128";
    case "qr_code":
      return "QR";
    default:
      return "OTHER";
  }
}

export interface ParsedBarcode {
  readonly code: string;
  readonly symbology: BarcodeSymbology;
}

/**
 * フォーム・URLから来たシンボロジー名を読む。知らない値は`null`。
 *
 * 呼び出し側はコード自体から推定した値へ落とす。シンボロジーは記録用の情報で、
 * ここが決まらないことを理由に登録を止める必要はない。
 */
export function parseSymbology(raw: string | undefined | null): BarcodeSymbology | null {
  const value = (raw ?? "").trim();
  return BARCODE_SYMBOLOGIES.find((symbology) => symbology === value) ?? null;
}

/**
 * 手入力・URLのクエリから来たコードを読み取る。値が使えない場合は`InventoryInputError`。
 *
 * チェックディジットの不一致は**拒否する**。合わないコードでそのまま登録すると、
 * 次に正しく読み取ったときに別のコードとして扱われ、紐付けが増えるだけになる。
 */
export function parseBarcode(raw: string | undefined | null, field = "code"): ParsedBarcode {
  const code = normalizeBarcode(raw);

  if (code === "") {
    throw new InventoryInputError(field, "バーコードを入力してください。");
  }
  if (code.length > MAX_CODE_LENGTH) {
    throw new InventoryInputError(field, `バーコードは${MAX_CODE_LENGTH}文字までです。`);
  }
  if (!/^[0-9A-Z.$/+%*]+$/.test(code)) {
    throw new InventoryInputError(field, "バーコードに使えない文字が含まれています。");
  }
  if (/^\d+$/.test(code) && code.length < 8) {
    throw new InventoryInputError(field, "数字のバーコードは8桁以上です。桁が足りていないようです。");
  }
  if (!hasValidCheckDigit(code)) {
    throw new InventoryInputError(
      field,
      "このコードは数字の並びが合いません。パッケージの数字をもう一度確かめてください。",
    );
  }

  return { code, symbology: detectSymbology(code) };
}

/**
 * 表示用に区切りを入れる（`4901777018884` → `4 901777 018884`）。
 *
 * パッケージの印字と同じ区切りにして、目で突き合わせられるようにする。
 */
export function formatBarcode(code: string): string {
  if (/^\d{13}$/.test(code)) {
    return `${code.slice(0, 1)} ${code.slice(1, 7)} ${code.slice(7)}`;
  }
  if (/^\d{8}$/.test(code)) {
    return `${code.slice(0, 4)} ${code.slice(4)}`;
  }
  if (/^\d{12}$/.test(code)) {
    return `${code.slice(0, 1)} ${code.slice(1, 6)} ${code.slice(6, 11)} ${code.slice(11)}`;
  }
  return code;
}
