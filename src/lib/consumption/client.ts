/**
 * 写真を送って「何が見えたか」を読む（#11）。
 *
 * **接続と資格情報の扱いは`src/lib/intake/`（#10）の基盤をそのまま使う。**
 * 設定（`readIntakeConfig()`）・モデルの選択・費用の概算・エラーの言い換えは共通で、
 * ここが持つのは#11固有のプロンプトと出力の形（`observations.ts`）だけ。
 *
 * **このモジュールは外との通信だけを担い、DBには触らない。**
 * **DBのトランザクションの中からは呼ばない**（#10・Notion連携と同じ約束）。
 */
import Anthropic from "@anthropic-ai/sdk";

import { estimateCostYen, type IntakeConfig, type IntakeModelId } from "../intake/config.ts";
import type { ImageType } from "../intake/image.ts";
import type { ConsumptionScanKind } from "./kinds.ts";
import {
  OBSERVATION_OUTPUT_SCHEMA,
  OBSERVATION_SYSTEM_PROMPT,
  ObservationFormatError,
  buildObservationInstruction,
  parseObservations,
  type VisionObservation,
} from "./observations.ts";

/**
 * 出力の上限。観察は最大12件で、1件あたり100トークン程度なので十分な余裕がある。
 * 大きくしすぎると、応答が壊れたときに払うトークンだけが増える（#10と同じ考え方）。
 */
const MAX_OUTPUT_TOKENS = 4_000;

/** 1回の呼び出しの待ち時間。画面の操作から呼ぶため、SDKの既定（10分）では長すぎる。 */
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 1;

export interface ObservationUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostYen: number;
}

export interface ObservationOutcome extends ObservationUsage {
  readonly observations: readonly VisionObservation[];
}

export interface OutgoingImage {
  readonly mimeType: ImageType;
  readonly base64: string;
}

/**
 * 応答は届いたが、こちらが使える形ではなかったときの失敗。
 *
 * **払ったぶんのトークンを一緒に持つ。** 応答が返ってきている以上その回は課金されており、
 * 0として記録すると、読めない応答が続くあいだ月の上限がいつまでも効かない（#10と同じ）。
 */
export class ObservationResponseError extends Error {
  readonly usage: ObservationUsage;

  constructor(message: string, usage: ObservationUsage) {
    super(message);
    this.name = "ObservationResponseError";
    this.usage = usage;
  }
}

/** 通信・応答の失敗。`retryable`がtrueなら、同じ画像でもう一度試す意味がある。 */
export class ObservationRequestError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "ObservationRequestError";
    this.retryable = retryable;
  }
}

function createClient(config: IntakeConfig): Anthropic {
  const common = {
    baseURL: config.baseUrl ?? undefined,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: MAX_RETRIES,
  };

  if (config.credential.kind === "apiKey") {
    return new Anthropic({ ...common, apiKey: config.credential.value });
  }

  // OAuthのアクセストークンは`Authorization: Bearer`で送る。この形はbetaヘッダーが要る。
  return new Anthropic({
    ...common,
    apiKey: null,
    authToken: config.credential.value,
    defaultHeaders: { "anthropic-beta": "oauth-2025-04-20" },
  });
}

/**
 * 写真を送り、読み取れたものを返す。
 *
 * `effort`は`low`。パッケージの表示を読むだけの仕事で、既定の`high`のままだと
 * 出力トークンだけが増える（#10がレシートで`medium`にしているのと同じ判断で、
 * こちらは読む量がさらに少ない）。
 */
export async function requestObservations(
  config: IntakeConfig,
  model: IntakeModelId,
  kind: ConsumptionScanKind,
  images: readonly OutgoingImage[],
): Promise<ObservationOutcome> {
  const client = createClient(config);

  const content: Anthropic.ContentBlockParam[] = [
    ...images.map(
      (image): Anthropic.ContentBlockParam => ({
        type: "image",
        source: { type: "base64", media_type: image.mimeType, data: image.base64 },
      }),
    ),
    { type: "text", text: buildObservationInstruction(kind) },
  ];

  let message: Anthropic.Message;
  try {
    message = await client.messages.create({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: OBSERVATION_SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
      output_config: {
        effort: "low",
        format: {
          type: "json_schema",
          schema: OBSERVATION_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
        },
      },
    });
  } catch (error) {
    throw toRequestError(error);
  }

  const tokens = {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  };
  const usage: ObservationUsage = {
    ...tokens,
    estimatedCostYen: estimateCostYen(tokens, model, config.usdJpy),
  };

  if (message.stop_reason === "refusal") {
    throw new ObservationResponseError(
      "この写真の読み取りは断られました。別の写真を試すか、在庫から選んで手で減らしてください。",
      usage,
    );
  }
  if (message.stop_reason === "max_tokens") {
    throw new ObservationResponseError(
      "写っているものが多すぎて応答が途中で切れました。写真を分けて撮ってください。",
      usage,
    );
  }

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ObservationResponseError("読み取り結果をJSONとして読めませんでした。", usage);
  }

  try {
    return { observations: parseObservations(raw), ...usage };
  } catch (error) {
    throw new ObservationResponseError(
      error instanceof ObservationFormatError
        ? "読み取り結果を解釈できませんでした。もう一度お試しください。"
        : "読み取り結果を扱えませんでした。",
      usage,
    );
  }
}

/**
 * SDKの例外を、画面へ出せる言葉へ直す。
 *
 * **例外のメッセージをそのまま画面へ出さない。** 資格情報の一部や内部のURLが混ざりうるため。
 */
function toRequestError(error: unknown): ObservationRequestError {
  if (error instanceof Anthropic.AuthenticationError) {
    return new ObservationRequestError(
      "AIの資格情報が受け付けられませんでした。設定を確認してください。",
      false,
    );
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new ObservationRequestError(
      "混み合っています。少し待ってからもう一度お試しください。",
      true,
    );
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new ObservationRequestError(
      "写真を受け付けてもらえませんでした。枚数や大きさをご確認ください。",
      false,
    );
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new ObservationRequestError(
      "読み取りに時間がかかりすぎました。もう一度お試しください。",
      true,
    );
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new ObservationRequestError("AIへ接続できませんでした。通信の状態をご確認ください。", true);
  }
  if (error instanceof Anthropic.APIError) {
    return new ObservationRequestError(`AIの応答が失敗しました（${error.status ?? "不明"}）。`, true);
  }
  return new ObservationRequestError("読み取りに失敗しました。", true);
}
