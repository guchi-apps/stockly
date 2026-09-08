/**
 * 画像を読むモデルへの呼び出し（#11。購入写真AI #10 と共通で使う）。
 *
 * **モデルに決めさせるのは「写真に何が見えたか」までで、商品も数量も決めさせない。**
 * どの在庫のことなのか・いくつ減らすのかは`src/lib/consumption/matching.ts`が現在庫から決める
 * （技術上の前提「既知ルールと現在庫をAIより優先する」）。ここが返すのは、読み取れた文字・
 * バーコード・見えた個数・残量の割合といった、写真そのものの観察だけ。
 *
 * 依存は足していない（`fetch`で直接叩く）。使うのは`/v1/messages`ひとつで、SDKを入れても
 * 呼ぶ先は同じになるため（`src/lib/notion/client.ts`と同じ判断）。
 *
 * **応答をそのままDB操作へ渡さない**（受入条件）。`parseObservations()`が型・範囲・件数を
 * 確かめ、外れた値は落とす。
 */
import { toBase64, type PreparedImage } from "./image.ts";
import type { VisionConfig } from "./config.ts";

/** Messages APIのバージョン。上げるときは、送っているツール定義の形も確かめること。 */
const ANTHROPIC_VERSION = "2023-06-01";

/** 1リクエストの待ち時間。モデルが詰まったときに画面を待たせ続けない。 */
const REQUEST_TIMEOUT_MS = 60_000;

/** 返してもらう観察の上限。棚を撮ると際限なく並びうるので、ここで頭打ちにする。 */
export const MAX_OBSERVATIONS = 12;

const MAX_TOKENS = 2_000;

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

/** モデルへ送れなかった・応答を使えなかったことを表す。`message`はそのまま画面に出す。 */
export class VisionRequestError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "VisionRequestError";
    this.status = status;
  }
}

/**
 * 観察を報告させるツールの定義。
 *
 * **`strict: true`＋`additionalProperties: false`**にしてあるので、返ってくる引数はこの形に必ず沿う。
 * それでも`parseObservations()`で確かめ直すのは、モデルの応答は外部入力だから
 * （ツールを使わずに文章で返す経路も残っている）。
 */
export const OBSERVATION_TOOL = {
  name: "report_observations",
  description:
    "写真から読み取れたものを報告する。写っているものだけを挙げ、写っていないものを推測で足さない。",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      observations: {
        type: "array",
        maxItems: MAX_OBSERVATIONS,
        items: {
          type: "object",
          properties: {
            label: {
              type: "string",
              description: "パッケージに書かれている商品名。読み取れた文字をそのまま。",
            },
            barcode: {
              type: ["string", "null"],
              description: "読み取れたバーコードの数字列。読めなければ null。",
            },
            confidence: {
              type: "number",
              description: "この観察の確からしさ。0〜1。読み取りに自信が無いときは低くする。",
            },
            visibleCount: {
              type: ["integer", "null"],
              description: "棚の写真で、その商品が何個写っているか。数えられなければ null。",
            },
            remainingRatio: {
              type: ["number", "null"],
              description: "容器に中身がどれだけ残っているか（0〜1）。分からなければ null。",
            },
            containerCount: {
              type: ["integer", "null"],
              description: "空になった容器が何個写っているか。分からなければ null。",
            },
            note: {
              type: ["string", "null"],
              description: "読めなかった箇所や迷った点。無ければ null。",
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
  },
} as const;

const SYSTEM_PROMPT = [
  "あなたは家庭の在庫アプリのために、写真に写っているものを読み取る役です。",
  "守ること:",
  "- 写真から実際に読み取れたものだけを報告する。写っていないものを推測で足さない。",
  "- 商品名は、パッケージに書かれている文字をそのまま写す。言い換えや補完をしない。",
  "- 数量・在庫・保管場所を決めるのはアプリ側の仕事なので、あなたは判断しない。",
  "- 自信が無いときは confidence を低くする。無理に高くしない。",
  `- 報告は report_observations ツールで返す。写っているものが無ければ observations を空にする。`,
].join("\n");

/** リクエストの本体を組み立てる（純関数。テストはここまでを確かめる）。 */
export function buildRequestBody(
  config: VisionConfig,
  prompt: string,
  images: readonly PreparedImage[],
): Record<string, unknown> {
  return {
    model: config.model,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    // 写真1枚から表示を読み取るだけの仕事なので、思考の深さは低くてよい（費用の歯止め）。
    output_config: { effort: "low" },
    tools: [OBSERVATION_TOOL],
    messages: [
      {
        role: "user",
        content: [
          ...images.map((image) => ({
            type: "image",
            source: {
              type: "base64",
              media_type: image.mediaType,
              data: toBase64(image.bytes),
            },
          })),
          { type: "text", text: prompt },
        ],
      },
    ],
  };
}

/**
 * 応答から観察を取り出す。**壊れた値は落とし、例外にしない。**
 *
 * 1件が読めなかったからといって全部を捨てると、まともに読めた候補まで消える。
 * ツールを使わず文章で返してきた場合は0件になり、呼び出し側が「読み取れませんでした」を出す。
 */
export function parseObservations(payload: unknown): VisionObservation[] {
  const content = (payload as { content?: unknown })?.content;
  if (!Array.isArray(content)) return [];

  const raw: unknown[] = [];
  for (const block of content) {
    const typed = block as { type?: unknown; name?: unknown; input?: unknown };
    if (typed?.type !== "tool_use" || typed.name !== OBSERVATION_TOOL.name) continue;
    const list = (typed.input as { observations?: unknown })?.observations;
    if (Array.isArray(list)) raw.push(...list);
  }

  return raw
    .slice(0, MAX_OBSERVATIONS)
    .map(toObservation)
    .filter((observation): observation is VisionObservation => observation !== null);
}

function toObservation(value: unknown): VisionObservation | null {
  const row = value as Record<string, unknown> | null;
  if (!row || typeof row !== "object") return null;

  const label = typeof row.label === "string" ? row.label.trim().slice(0, 200) : "";
  if (label === "") return null;

  return {
    label,
    barcode: digits(row.barcode),
    confidence: ratio(row.confidence) ?? 0,
    visibleCount: count(row.visibleCount),
    remainingRatio: ratio(row.remainingRatio),
    containerCount: count(row.containerCount),
    note: typeof row.note === "string" && row.note.trim() !== "" ? row.note.trim().slice(0, 200) : null,
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

/** バーコードは数字だけを残す。空になれば`null`（照合には`parseBarcode()`が改めて効く）。 */
function digits(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const only = value.replace(/\D/g, "");
  return only === "" ? null : only.slice(0, 64);
}

/**
 * 写真を送り、観察を受け取る。
 *
 * **在庫は一切触らない。** ここが失敗しても戻すものは無く、利用者はそのまま手で減らせる。
 */
export async function readObservations(
  config: VisionConfig,
  prompt: string,
  images: readonly PreparedImage[],
): Promise<{ observations: VisionObservation[]; model: string }> {
  let response: Response;
  try {
    response = await fetch(`${config.apiBaseUrl}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": config.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify(buildRequestBody(config, prompt, images)),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new VisionRequestError(
      `写真を読むサービスに接続できませんでした（${error instanceof Error ? error.name : "unknown"}）。時間をおいてもう一度お試しください。`,
    );
  }

  const payload = await readJson(response);
  if (!response.ok) {
    throw new VisionRequestError(describeFailure(response.status, payload), response.status);
  }

  const model = typeof payload?.model === "string" ? payload.model : config.model;
  return { observations: parseObservations(payload), model };
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * 失敗の理由を、そのまま画面に出せる日本語にする。
 *
 * **リクエストの中身（APIキーを含むヘッダー）はここへ出さない。**
 */
function describeFailure(status: number, payload: Record<string, unknown> | null): string {
  const error = payload?.error as { message?: unknown } | undefined;
  const detail = typeof error?.message === "string" ? error.message.slice(0, 200) : "";

  if (status === 401 || status === 403) {
    return `写真を読むサービスへの権限がありません（${status}）。APIキーの設定を確かめてください。`;
  }
  if (status === 413) {
    return "写真が大きすぎて送れませんでした。枚数を減らすか、小さめに撮り直してください。";
  }
  if (status === 429) {
    return "写真を読むサービスが混み合っています（429）。少し待ってからもう一度お試しください。";
  }
  if (status >= 500) {
    return `写真を読むサービス側で失敗しました（${status}）。時間をおいてもう一度お試しください。`;
  }
  return `写真を読み取れませんでした（${status}）。${detail}`;
}
