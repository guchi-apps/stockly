/**
 * Claude APIへ写真を送って登録候補を読む（#10）。
 *
 * **このモジュールは外との通信だけを担い、DBには触らない。** 呼び出しは
 * `service.ts`が行い、結果は必ず`extraction.ts`の`parseExtraction()`を通してから使う。
 *
 * **DBのトランザクションの中からは呼ばない**（Notion連携と同じ約束）。数十秒かかる通信を
 * トランザクションに巻き込むと、その間ロットの行を掴んだままになる。
 */
import Anthropic from "@anthropic-ai/sdk";

import { estimateCostYen, type IntakeConfig, type IntakeModelId } from "./config.ts";
import { ExtractionFormatError, parseExtraction, type ExtractedItem } from "./extraction.ts";
import {
  INTAKE_OUTPUT_SCHEMA,
  INTAKE_SYSTEM_PROMPT,
  buildInstruction,
  type PromptContext,
} from "./prompt.ts";

/**
 * 出力の上限。候補は最大40件で、1件あたり100トークン程度なので十分な余裕がある。
 * 大きくしすぎると、応答が壊れたときに払うトークンだけが増える。
 */
const MAX_OUTPUT_TOKENS = 8_000;

/**
 * 1回の呼び出しの待ち時間（ミリ秒）。SDKの既定は10分だが、画面の操作から呼ぶため
 * それでは長すぎる。**再試行は1回まで**——失敗のたびに画像を送り直すと費用がそのぶん増える。
 */
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 1;

export interface ExtractionUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostYen: number;
}

export interface ExtractionOutcome extends ExtractionUsage {
  readonly items: readonly ExtractedItem[];
}

/**
 * 応答は届いたが、こちらが使える形ではなかったときの失敗。
 *
 * **払ったぶんのトークンを一緒に持つ。** 応答が返ってきている以上その回は課金されており、
 * 0として記録すると、読めない応答が続くあいだ費用の上限がいつまでも効かない。
 */
export class IntakeResponseError extends Error {
  readonly usage: ExtractionUsage;

  constructor(message: string, usage: ExtractionUsage) {
    super(message);
    this.name = "IntakeResponseError";
    this.usage = usage;
  }
}

/** 通信・応答の失敗。`retryable`がtrueなら、同じ画像でもう一度試す意味がある。 */
export class IntakeRequestError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "IntakeRequestError";
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
 * 写真を送り、候補を読み取って返す。
 *
 * `effort`を`medium`にしてある。レシートの読み取りは長い推論を要する仕事ではなく、
 * 既定の`high`のままだと出力トークンだけが増えるため（費用の上限が効きやすいほうを採る）。
 */
export async function requestExtraction(
  config: IntakeConfig,
  model: IntakeModelId,
  context: PromptContext,
): Promise<ExtractionOutcome> {
  const client = createClient(config);

  const content: Anthropic.ContentBlockParam[] = [
    ...context.images.map(
      (image): Anthropic.ContentBlockParam => ({
        type: "image",
        source: {
          type: "base64",
          media_type: image.mimeType as "image/jpeg" | "image/png" | "image/webp",
          data: image.base64,
        },
      }),
    ),
    { type: "text", text: buildInstruction(context) },
  ];

  let message: Anthropic.Message;
  try {
    message = await client.messages.create({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: INTAKE_SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: INTAKE_OUTPUT_SCHEMA as unknown as Record<string, unknown> },
      },
    });
  } catch (error) {
    throw toRequestError(error);
  }

  const tokens = {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  };
  const usage: ExtractionUsage = {
    ...tokens,
    estimatedCostYen: estimateCostYen(tokens, model, config.usdJpy),
  };

  if (message.stop_reason === "refusal") {
    throw new IntakeResponseError(
      "この写真の読み取りは断られました。別の写真を試すか、手入力で登録してください。",
      usage,
    );
  }
  if (message.stop_reason === "max_tokens") {
    throw new IntakeResponseError(
      "候補が多すぎて応答が途中で切れました。写真を分けて取り込んでください。",
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
    throw new IntakeResponseError("読み取り結果をJSONとして読めませんでした。", usage);
  }

  try {
    return { items: parseExtraction(raw, { imageCount: context.images.length }), ...usage };
  } catch (error) {
    throw new IntakeResponseError(
      error instanceof ExtractionFormatError
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
function toRequestError(error: unknown): IntakeRequestError {
  if (error instanceof Anthropic.AuthenticationError) {
    return new IntakeRequestError(
      "AIの資格情報が受け付けられませんでした。設定を確認してください。",
      false,
    );
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new IntakeRequestError("混み合っています。少し待ってからもう一度お試しください。", true);
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new IntakeRequestError("写真を受け付けてもらえませんでした。枚数や大きさをご確認ください。", false);
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new IntakeRequestError("読み取りに時間がかかりすぎました。もう一度お試しください。", true);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new IntakeRequestError("AIへ接続できませんでした。通信の状態をご確認ください。", true);
  }
  if (error instanceof Anthropic.APIError) {
    return new IntakeRequestError(`AIの応答が失敗しました（${error.status ?? "不明"}）。`, true);
  }
  return new IntakeRequestError("読み取りに失敗しました。", true);
}
