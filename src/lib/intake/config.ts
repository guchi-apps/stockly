/**
 * 写真取込（#10）でClaude APIへつなぐための設定と、費用の概算。
 *
 * **接続先の実値（APIキー・トークン）はリポジトリに置かない。** 環境変数として渡し、
 * 本番はデプロイ時に`.env`へ書き込む（`.github/workflows/deploy.yml`の`update_env`）。
 * Notion連携（`src/lib/notion/config.ts`）と同じ方針で、**未設定でも画面は開く**
 * （抽出だけができない）。設定漏れで在庫の画面まで止めるのは割に合わない。
 *
 * 資格情報は2通りを受け付ける。どちらを入れるかは運用で決める。
 *
 * - `ANTHROPIC_API_KEY` … 従量課金のAPIキー。`x-api-key`で送る（想定される正規の使い方）
 * - `ANTHROPIC_AUTH_TOKEN` … OAuthのアクセストークン。`Authorization: Bearer`で送る
 *
 * ここにPrismaもNext.jsも持ち込まない（DBの無いCIで費用の計算と設定の読み取りを試せるように
 * するため。`config.test.ts`）。
 */

/** 使えるモデル。並び順がそのまま画面の選択肢の順になる。 */
export const INTAKE_MODELS = ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5"] as const;
export type IntakeModelId = (typeof INTAKE_MODELS)[number];

export const DEFAULT_INTAKE_MODEL: IntakeModelId = "claude-sonnet-5";

export interface ModelPricing {
  /** 100万入力トークンあたりのUSD。 */
  readonly inputUsdPerMTok: number;
  /** 100万出力トークンあたりのUSD。 */
  readonly outputUsdPerMTok: number;
  /** 画面に出す短い説明。 */
  readonly note: string;
}

/**
 * モデルごとの単価（Anthropicの公開価格）。
 *
 * **ここは費用上限の歯止めを出すための目安で、請求の正はAnthropic側の明細。**
 * 価格が変わったらこの表を直す（画面の概算がずれるだけで、抽出そのものは動き続ける）。
 */
export const MODEL_PRICING: Readonly<Record<IntakeModelId, ModelPricing>> = {
  "claude-sonnet-5": {
    inputUsdPerMTok: 2,
    outputUsdPerMTok: 10,
    note: "レシートの読み取りに十分で、費用も抑えられる",
  },
  "claude-opus-5": {
    inputUsdPerMTok: 5,
    outputUsdPerMTok: 25,
    note: "ぼやけた写真や手書きのラベルに強い。費用は約3倍",
  },
  "claude-haiku-4-5": {
    inputUsdPerMTok: 1,
    outputUsdPerMTok: 5,
    note: "最も安いが、細かい行や小さな印字を落としやすい",
  },
};

/** 画面に「何が足りないか」を出すための、環境変数名の一覧。どちらか1つあればよい。 */
export const INTAKE_CREDENTIAL_ENV_KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"] as const;

/** 概算に使うドル円のレート。実勢と多少ずれても、上限の歯止めとしては足りる。 */
const DEFAULT_USD_JPY = 155;

/** 1回の抽出で受け付ける画像の枚数と大きさ。ここを超える入力は送る前に弾く。 */
export const MAX_IMAGES_PER_BATCH = 5;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** 受け付ける画像の形式。ブラウザ側でJPEGへ変換してから送るが、念のため両方許す。 */
export const ALLOWED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

export interface IntakeCredential {
  readonly kind: "apiKey" | "authToken";
  /** **ログにも画面にも出さない。** */
  readonly value: string;
}

export interface IntakeConfig {
  readonly credential: IntakeCredential;
  /** APIの入口。テスト用のスタブへ差し替えるためだけに環境変数で上書きできる。 */
  readonly baseUrl: string | null;
  /** 家庭の設定でモデルを選んでいないときに使うモデル。 */
  readonly defaultModel: IntakeModelId;
  readonly usdJpy: number;
}

type EnvLike = Record<string, string | undefined>;

function value(env: EnvLike, key: string): string {
  return (env[key] ?? "").trim();
}

/** 与えられた文字列が使えるモデルidなら返す。そうでなければ`null`。 */
export function toIntakeModel(raw: string | null | undefined): IntakeModelId | null {
  const found = INTAKE_MODELS.find((model) => model === (raw ?? "").trim());
  return found ?? null;
}

/**
 * 設定が揃っていなければ`null`。揃っていれば、そのまま使える形にして返す。
 *
 * `ANTHROPIC_API_KEY`のほうを優先する。両方入っている環境で「どちらで課金されるのか」が
 * 分からなくなるより、常に同じほうを使うと決めておくほうが追いやすい。
 */
export function readIntakeConfig(env: EnvLike = process.env): IntakeConfig | null {
  const apiKey = value(env, "ANTHROPIC_API_KEY");
  const authToken = value(env, "ANTHROPIC_AUTH_TOKEN");

  const credential: IntakeCredential | null = apiKey
    ? { kind: "apiKey", value: apiKey }
    : authToken
      ? { kind: "authToken", value: authToken }
      : null;
  if (!credential) return null;

  const usdJpy = Number(value(env, "STOCKLY_AI_USD_JPY"));

  return {
    credential,
    baseUrl: value(env, "ANTHROPIC_BASE_URL").replace(/\/+$/, "") || null,
    defaultModel: toIntakeModel(value(env, "STOCKLY_AI_MODEL")) ?? DEFAULT_INTAKE_MODEL,
    usdJpy: Number.isFinite(usdJpy) && usdJpy > 0 ? usdJpy : DEFAULT_USD_JPY,
  };
}

/** 資格情報が1つも無いか。画面の案内に使う（値そのものは出さない）。 */
export function isIntakeConfigured(env: EnvLike = process.env): boolean {
  return readIntakeConfig(env) !== null;
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/**
 * トークン数から概算の金額（円）を出す。
 *
 * 小数第3位までに丸める（DBの`Decimal(10, 3)`に合わせる）。**切り上げにしてある**——
 * 上限の歯止めに使う値なので、丸めで下振れさせると上限をわずかに超えて止まらなくなる。
 */
export function estimateCostYen(
  usage: TokenUsage,
  model: IntakeModelId,
  usdJpy: number = DEFAULT_USD_JPY,
): number {
  const pricing = MODEL_PRICING[model];
  const usd =
    (Math.max(0, usage.inputTokens) / 1_000_000) * pricing.inputUsdPerMTok +
    (Math.max(0, usage.outputTokens) / 1_000_000) * pricing.outputUsdPerMTok;
  return Math.ceil(usd * usdJpy * 1000) / 1000;
}

/**
 * 1回の抽出にかかる金額のおおよその見積り。送信前の案内に使う。
 *
 * 画像1枚をおよそ1,600入力トークン（長辺1600pxのJPEG）、出力を1,200トークンとして数える。
 * **当たりを外すことより、桁を間違えないことのほうが大事**なので、細かく合わせない。
 */
export function estimateBatchCostYen(
  imageCount: number,
  model: IntakeModelId,
  usdJpy: number = DEFAULT_USD_JPY,
): number {
  return estimateCostYen(
    { inputTokens: Math.max(1, imageCount) * 1_600 + 900, outputTokens: 1_200 },
    model,
    usdJpy,
  );
}
