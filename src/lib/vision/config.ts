/**
 * 画像を読むAIの接続先（#11。購入写真AI #10 と共通で使う）。
 *
 * **実値（APIキー）はリポジトリに置かない。** 環境変数として渡し、本番はデプロイ時に`.env`へ
 * 書き込む（`.github/workflows/deploy.yml`の`update_env`）。Notion連携（`src/lib/notion/config.ts`）と
 * 同じ考え方で、**未設定でも画面は開く**（`readVisionConfig()`が`null`を返す）。写真から候補を出せない
 * だけで、在庫の登録・消費は手で行えるため、設定漏れで在庫の画面まで止めるのは割に合わない。
 *
 * **入口（`apiBaseUrl`）を設定値にしてある**のは、ローカルにスタブを立てて実際の送信・失敗・
 * 復旧を流して確かめられるようにするため（#6の`NOTION_API_BASE_URL`と同じ）。
 */

export interface VisionConfig {
  /** Anthropic APIキー。**ログにも画面にも出さない。** */
  readonly apiKey: string;
  /** 使うモデル。既定は`claude-opus-5`。 */
  readonly model: string;
  /** APIの入口。テスト・ローカルのスタブから差し替えるためだけに環境変数で上書きできる。 */
  readonly apiBaseUrl: string;
  /** 1回の解析で送れる画像の枚数。 */
  readonly maxImages: number;
  /** 1枚あたりのバイト数の上限。 */
  readonly maxImageBytes: number;
  /**
   * 1家庭・1日あたりに実行できる解析の回数。
   *
   * **費用の歯止めはここだけ。** 呼ぶたびに課金されるため、上限を超えたら解析せずに断る
   * （画面には「本日の解析 n / N 回」を常に出す）。
   */
  readonly dailyLimit: number;
}

/** 画面に「何が足りないか」を出すための、環境変数名の一覧。 */
export const VISION_REQUIRED_ENV_KEYS = ["ANTHROPIC_API_KEY"] as const;

const DEFAULT_API_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_MODEL = "claude-opus-5";
const DEFAULT_MAX_IMAGES = 4;
/** 1枚10MB（`docs/testing-strategy.md`の「画像アップロード制約の基準」）。 */
const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DEFAULT_DAILY_LIMIT = 20;

type EnvLike = Record<string, string | undefined>;

function value(env: EnvLike, key: string): string {
  return (env[key] ?? "").trim();
}

/** 正の整数として読む。読めない値は既定値へ倒す（設定ミスで上限が消えないように）。 */
function positiveInt(env: EnvLike, key: string, fallback: number): number {
  const raw = value(env, key);
  if (raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

/** 設定が揃っていなければ`null`。揃っていれば、そのまま使える形にして返す。 */
export function readVisionConfig(env: EnvLike = process.env): VisionConfig | null {
  const apiKey = value(env, "ANTHROPIC_API_KEY");
  if (apiKey === "") return null;

  return {
    apiKey,
    model: value(env, "STOCKLY_VISION_MODEL") || DEFAULT_MODEL,
    apiBaseUrl: (value(env, "STOCKLY_VISION_API_BASE_URL") || DEFAULT_API_BASE_URL).replace(
      /\/+$/,
      "",
    ),
    maxImages: positiveInt(env, "STOCKLY_VISION_MAX_IMAGES", DEFAULT_MAX_IMAGES),
    maxImageBytes: positiveInt(env, "STOCKLY_VISION_MAX_IMAGE_BYTES", DEFAULT_MAX_IMAGE_BYTES),
    dailyLimit: positiveInt(env, "STOCKLY_VISION_DAILY_LIMIT", DEFAULT_DAILY_LIMIT),
  };
}

/** 未設定の環境変数名。画面の案内に使う（値そのものは出さない）。 */
export function missingVisionConfigKeys(env: EnvLike = process.env): string[] {
  return VISION_REQUIRED_ENV_KEYS.filter((key) => value(env, key) === "");
}

/**
 * 設定が無いときにも画面が使う上限。
 *
 * 枚数の上限は「送る前」に効かせたいので、APIキーの有無とは切り離しておく
 * （未設定のときも同じ枚数までしか選べないほうが、後から設定したときの挙動が変わらない）。
 */
export const VISION_LIMITS = {
  maxImages: DEFAULT_MAX_IMAGES,
  maxImageBytes: DEFAULT_MAX_IMAGE_BYTES,
  dailyLimit: DEFAULT_DAILY_LIMIT,
} as const;
