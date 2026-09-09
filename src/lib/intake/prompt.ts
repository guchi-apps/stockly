/**
 * 写真から登録候補を読むためのプロンプトと、応答の形（#10）。
 *
 * **AIに決めさせるのは「写真に何が写っているか」までで、在庫をどうするかではない。**
 * 確定済みルール・バーコードとの優先順位づけは`src/lib/barcode/candidate.ts`が、
 * 在庫への反映は`src/lib/inventory/service.ts`が持つ。ここが返すのは材料だけ。
 *
 * 版を上げるときは`extraction.ts`の`INTAKE_PROMPT_VERSION`も一緒に上げる。
 */
import { UNIT_DEFINITIONS, type UnitCode } from "../inventory/units.ts";

/** 写真の種類。DBの`IntakeImageKind`と同じ並びにしてある。 */
export const INTAKE_IMAGE_KINDS = ["RECEIPT", "PURCHASE", "EXPIRY_LABEL", "UNKNOWN"] as const;
export type IntakeImageKind = (typeof INTAKE_IMAGE_KINDS)[number];

export const INTAKE_IMAGE_KIND_LABELS: Readonly<Record<IntakeImageKind, string>> = {
  RECEIPT: "レシート",
  PURCHASE: "購入品",
  EXPIRY_LABEL: "期限ラベル",
  UNKNOWN: "おまかせ",
};

/** 種類ごとに、モデルへ何を読ませたいかの説明。 */
const KIND_INSTRUCTIONS: Readonly<Record<IntakeImageKind, string>> = {
  RECEIPT:
    "レシート。明細の行を1行1件として読む。小計・合計・値引き・ポイント・レジ袋・お預かり・" +
    "お釣りの行は在庫にしないので ignore を true にする。レシートに期限は印字されないため、" +
    "expiryKind は UNKNOWN のままにする。",
  PURCHASE:
    "買ってきた品物を並べて撮った写真。写っている品物ごとに1件にする。同じ品物が複数写って" +
    "いれば数量にまとめる。パッケージに期限が読めればそれも入れる。",
  EXPIRY_LABEL:
    "期限の印字を撮った写真。読めるのは期限だけのことが多い。商品名が写っていなければ " +
    "productName は null にする（推測で埋めない）。",
  UNKNOWN: "種類が指定されていない。写真を見て、レシート・購入品・期限ラベルのどれかとして読む。",
};

export const INTAKE_SYSTEM_PROMPT = [
  "あなたは家庭の在庫アプリの入力補助です。渡された写真から、在庫に登録する候補を読み取ります。",
  "",
  "守ること:",
  "- **読めないものは推測しない。** 読めなかった欄は null にする。0や空文字で埋めない",
  "- 写真に写っていないことを補わない。商品名が写っていなければ null にする",
  "- 期限は写真に印字されている日付だけを入れる。「たぶん1年後」のような推定はしない",
  "- 和暦・「26.09.15」「2026/9/15」のような表記は西暦のYYYY-MM-DDへ直す。" +
    "年が2桁なら2000年代として読む",
  "- 数量が読み取れないときは amount を null にする。1と決め打ちしない",
  "- confidence は、その読みがどれだけ確かかを0〜1で入れる。ぼやけている・一部が隠れている" +
    "ときは低くする。分からないときは null",
  "- evidence には、どこをどう読んだかを日本語1文で書く（レシートの行そのものなど）",
  "",
  "出力は指定されたJSONの形だけを返す。説明文は書かない。",
].join("\n");

/** モデルへ渡す出力の形（`output_config.format`）。 */
export const INTAKE_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      description: "写真から読み取った登録候補。読めるものが無ければ空配列。",
      items: {
        type: "object",
        properties: {
          imageIndex: {
            type: ["integer", "null"],
            description: "何枚目の写真から読んだか（0始まり）",
          },
          ignore: {
            type: "boolean",
            description: "在庫にしない行（小計・値引き・レジ袋など）ならtrue",
          },
          productName: { type: ["string", "null"], description: "商品名。読めなければnull" },
          brand: { type: ["string", "null"], description: "メーカー・ブランド名" },
          categoryName: {
            type: ["string", "null"],
            description: "カテゴリ（食品・飲料・日用品など）",
          },
          amount: { type: ["string", "null"], description: "数量。半角の数字だけ。読めなければnull" },
          unit: {
            type: ["string", "null"],
            enum: [...Object.keys(UNIT_DEFINITIONS), null],
            description: "数量の単位",
          },
          expiryKind: {
            type: "string",
            enum: ["UNKNOWN", "NONE", "BEST_BEFORE", "USE_BY"],
            description: "期限の種類。読めなければUNKNOWN",
          },
          expiryDate: { type: ["string", "null"], description: "期限（YYYY-MM-DD）" },
          storageName: {
            type: ["string", "null"],
            description: "写真から分かる置き場所の呼び名（冷蔵庫・食品棚など）",
          },
          evidence: { type: ["string", "null"], description: "どこをどう読んだかの説明（日本語1文）" },
          confidence: { type: ["number", "null"], description: "候補全体の確からしさ（0〜1）" },
          fieldConfidence: {
            type: "object",
            properties: {
              productName: { type: ["number", "null"] },
              amount: { type: ["number", "null"] },
              expiry: { type: ["number", "null"] },
              category: { type: ["number", "null"] },
              storage: { type: ["number", "null"] },
            },
            required: ["productName", "amount", "expiry", "category", "storage"],
            additionalProperties: false,
          },
        },
        required: [
          "imageIndex",
          "ignore",
          "productName",
          "brand",
          "categoryName",
          "amount",
          "unit",
          "expiryKind",
          "expiryDate",
          "storageName",
          "evidence",
          "confidence",
          "fieldConfidence",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
} as const;

export interface PromptImage {
  readonly kind: IntakeImageKind;
  readonly mimeType: string;
  readonly base64: string;
}

export interface PromptContext {
  readonly images: readonly PromptImage[];
  /** 使える保管場所の名前。写真から読んだ置き場所をここへ寄せてもらう。 */
  readonly storageNames: readonly string[];
  /**
   * 登録済みの商品名。**設定でオンにしたときだけ渡す**（既定はオフ）。
   * 表記ゆれを既存商品へ寄せやすくなるが、家庭の持ち物がモデルへ渡るため。
   */
  readonly productNames?: readonly string[] | null;
}

/** 一覧をプロンプトへ入れるときの上限。長くしすぎると入力トークンだけが増える。 */
const MAX_HINT_ITEMS = 200;

/** 画像の後ろに置く指示文。何枚目が何の写真かを、画像の並び順と対応させて書く。 */
export function buildInstruction(context: PromptContext): string {
  const lines: string[] = ["写真は以下の順で渡しています。"];

  context.images.forEach((image, index) => {
    lines.push(`- ${index}枚目（imageIndex: ${index}）: ${KIND_INSTRUCTIONS[image.kind]}`);
  });

  lines.push("");
  lines.push(`単位は次のどれかを使ってください: ${describeUnits()}`);

  if (context.storageNames.length > 0) {
    lines.push(
      "",
      "この家庭にある保管場所は次のとおりです。写真から置き場所が分かるときは、" +
        "この中の名前をそのまま storageName に入れてください（当てはまらなければ null）。",
      context.storageNames.slice(0, MAX_HINT_ITEMS).map((name) => `- ${name}`).join("\n"),
    );
  }

  if (context.productNames && context.productNames.length > 0) {
    lines.push(
      "",
      "すでに登録されている商品名です。同じ商品だと読めるときは、レシートの略称ではなく" +
        "この表記を productName に入れてください。",
      context.productNames.slice(0, MAX_HINT_ITEMS).map((name) => `- ${name}`).join("\n"),
    );
  }

  return lines.join("\n");
}

function describeUnits(): string {
  return (Object.keys(UNIT_DEFINITIONS) as UnitCode[])
    .map((code) => `${code}（${UNIT_DEFINITIONS[code].label}）`)
    .join("、");
}
