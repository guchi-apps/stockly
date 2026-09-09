/**
 * 写真から「何が見えたか」を読むためのプロンプトと、応答の形（#11）。
 *
 * **AIに決めさせるのは「写真に何が写っているか」までで、在庫をどうするかではない。**
 * どの商品のどのロットをいくつ減らすかは`matching.ts`が現在庫だけを材料に決める。
 * ここが返すのは材料（読めた表示・バーコード・見えた個数・残量の割合）だけ。
 *
 * 接続そのものは`src/lib/intake/`（#10）の基盤に載せる。ここにあるのは#11固有の
 * 「何を読ませるか」と「返ってきたものをどう検証するか」だけ。
 *
 * ここにはPrismaもNext.jsも持ち込まない（DBの無いCIで検証だけを試せるようにするため。
 * `observations.test.ts`）。
 */
import { SCAN_KIND_DEFINITIONS, type ConsumptionScanKind } from "./kinds.ts";

/**
 * プロンプトの版。**読ませ方を変えたら上げる**（`ConsumptionScan.ruleVersion`と対で
 * 「どの条件で出した候補か」を辿れるようにする）。
 */
export const OBSERVATION_PROMPT_VERSION = "v1";

/** 返してもらう観察の上限。棚を撮ると際限なく並びうるので、ここで頭打ちにする。 */
export const MAX_OBSERVATIONS = 12;

/** 写真から読み取れたもの1件。**商品idも在庫も含まない。** */
export interface VisionObservation {
  /** 読み取れた商品名らしき表示。照合の材料であり、根拠として画面にも出す。 */
  readonly label: string;
  /** 読み取れたバーコードの数字列。無ければ`null`。 */
  readonly barcode: string | null;
  /** モデル自身の確からしさ（0〜1）。 */
  readonly confidence: number;
  /** 棚の写真で、写っていた個数。 */
  readonly visibleCount: number | null;
  /** 残量の写真で、容器に残っている割合（0〜1）。 */
  readonly remainingRatio: number | null;
  /** 空き容器の写真で、空になっていた容器の数。 */
  readonly containerCount: number | null;
  /** 読めなかったもの・迷った点など。根拠としてそのまま画面に出す。 */
  readonly note: string | null;
}

export const OBSERVATION_SYSTEM_PROMPT = [
  "あなたは家庭の在庫アプリの入力補助です。渡された写真から、何が写っているかだけを読み取ります。",
  "",
  "守ること:",
  "- **読めないものは推測しない。** 読めなかった欄は null にする。0や1で埋めない",
  "- 商品名は、パッケージに書かれている文字をそのまま写す。言い換えや補完をしない",
  "- 写真に写っていないものを足さない",
  "- **どの在庫をいくつ減らすかは決めない。** それはアプリ側の仕事なので、あなたは数えるだけ",
  "- confidence は、その読みがどれだけ確かかを0〜1で入れる。ぼやけている・一部が隠れている" +
    "ときは低くする",
  "",
  "出力は指定されたJSONの形だけを返す。説明文は書かない。",
].join("\n");

/** モデルへ渡す出力の形（`output_config.format`）。 */
export const OBSERVATION_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    observations: {
      type: "array",
      description: "写真から読み取れたもの。読めるものが無ければ空配列。",
      items: {
        type: "object",
        properties: {
          label: {
            type: ["string", "null"],
            description: "パッケージに書かれている商品名。読めなければnull",
          },
          barcode: {
            type: ["string", "null"],
            description: "読み取れたバーコードの数字列。読めなければnull",
          },
          confidence: {
            type: ["number", "null"],
            description: "この読みの確からしさ。0〜1。分からなければnull",
          },
          visibleCount: {
            type: ["integer", "null"],
            description: "棚の写真で、その商品が何個写っているか。数えられなければnull",
          },
          remainingRatio: {
            type: ["number", "null"],
            description: "容器に中身がどれだけ残っているか（0〜1）。分からなければnull",
          },
          containerCount: {
            type: ["integer", "null"],
            description: "空になった容器が何個写っているか。分からなければnull",
          },
          note: {
            type: ["string", "null"],
            description: "読めなかった箇所や迷った点。無ければnull",
          },
        },
        required: [
          "label",
          "barcode",
          "confidence",
          "visibleCount",
          "remainingRatio",
          "containerCount",
          "note",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["observations"],
  additionalProperties: false,
} as const;

/** 写真の種類ごとの指示。タブの並びと同じ`kinds.ts`を正本にする。 */
export function buildObservationInstruction(kind: ConsumptionScanKind): string {
  return [
    SCAN_KIND_DEFINITIONS[kind].prompt,
    "",
    `1回に報告するのは多くても${MAX_OBSERVATIONS}件までにしてください。`,
  ].join("\n");
}

/** 応答の形が想定と違ったとき。#10の`ExtractionFormatError`と同じ役割。 */
export class ObservationFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObservationFormatError";
  }
}

/**
 * モデルの応答を検証して観察の配列にする。**そのままDB操作へ渡さない**（受入条件）。
 *
 * **1件が壊れていても全部を捨てない。** まともに読めた候補まで消すと、写真を撮り直すしかなくなる。
 * 壊れた欄は`null`（＝読めなかった）として残りを活かし、名前が読めなかった行だけを落とす
 * （照合の手がかりが何も無いため）。
 */
export function parseObservations(raw: unknown): VisionObservation[] {
  const list = (raw as { observations?: unknown } | null)?.observations;
  if (!Array.isArray(list)) {
    throw new ObservationFormatError("observations が配列ではありません。");
  }

  return list
    .slice(0, MAX_OBSERVATIONS)
    .map(toObservation)
    .filter((observation): observation is VisionObservation => observation !== null);
}

function toObservation(value: unknown): VisionObservation | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;

  const label = typeof row.label === "string" ? row.label.trim().slice(0, 200) : "";
  if (label === "") return null;

  const note = typeof row.note === "string" ? row.note.trim().slice(0, 200) : "";

  return {
    label,
    barcode: digits(row.barcode),
    confidence: ratio(row.confidence) ?? 0,
    visibleCount: count(row.visibleCount),
    remainingRatio: ratio(row.remainingRatio),
    containerCount: count(row.containerCount),
    note: note === "" ? null : note,
  };
}

/** 0〜1の外にある値は「読めなかった」として落とす（丸めて使うと、根拠のない数字が残る）。 */
function ratio(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > 1) return null;
  return value;
}

/** 個数は0以上の整数だけ。負や小数はモデルの誤りなので落とす。 */
function count(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < 0 || value > 999) return null;
  return value;
}

/** バーコードは数字だけを残す。空になれば`null`（照合側で改めて突き合わせる）。 */
function digits(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const only = value.replace(/\D/g, "");
  return only === "" ? null : only.slice(0, 64);
}
