/**
 * Notion買い物リストの接続先。
 *
 * **接続先の実値（トークン・データベースid）はリポジトリに置かない。** 環境変数として渡し、
 * 本番はデプロイ時に`.env`へ書き込む（`.github/workflows/deploy.yml`の`update_env`）。
 *
 * 未設定でも画面は開けるようにしてある（`readNotionConfig()`が`null`を返す）。買い物リストへ
 * 送れないだけで、補充基準の編集や候補の確認は在庫の情報だけでできるため、
 * 設定漏れで在庫の画面まで使えなくなるのは割に合わない。
 */

export interface NotionConfig {
  /** Notionのインテグレーショントークン。**ログにも画面にも出さない。** */
  readonly token: string;
  /** 買い物リストのデータベースid。 */
  readonly databaseId: string;
  /** 品名を入れるタイトルプロパティの名前。 */
  readonly titleProperty: string;
  /** 数量を入れるテキストプロパティの名前。未設定なら数量は送らない。 */
  readonly quantityProperty: string | null;
  /** Stockly側の対応IDを入れるテキストプロパティの名前。未設定なら送らない。 */
  readonly sourceProperty: string | null;
  /** APIの入口。テストから差し替えるためだけに環境変数で上書きできる。 */
  readonly apiBaseUrl: string;
}

/** 画面に「何が足りないか」を出すための、環境変数名の一覧。 */
export const NOTION_REQUIRED_ENV_KEYS = ["NOTION_API_TOKEN", "NOTION_SHOPPING_DATABASE_ID"] as const;

const DEFAULT_API_BASE_URL = "https://api.notion.com/v1";
const DEFAULT_TITLE_PROPERTY = "名前";

type EnvLike = Record<string, string | undefined>;

function value(env: EnvLike, key: string): string {
  return (env[key] ?? "").trim();
}

/** 設定が揃っていなければ`null`。揃っていれば、そのまま使える形にして返す。 */
export function readNotionConfig(env: EnvLike = process.env): NotionConfig | null {
  const token = value(env, "NOTION_API_TOKEN");
  const databaseId = value(env, "NOTION_SHOPPING_DATABASE_ID");
  if (token === "" || databaseId === "") return null;

  return {
    token,
    databaseId,
    titleProperty: value(env, "NOTION_SHOPPING_TITLE_PROPERTY") || DEFAULT_TITLE_PROPERTY,
    quantityProperty: value(env, "NOTION_SHOPPING_QUANTITY_PROPERTY") || null,
    sourceProperty: value(env, "NOTION_SHOPPING_SOURCE_PROPERTY") || null,
    apiBaseUrl: (value(env, "NOTION_API_BASE_URL") || DEFAULT_API_BASE_URL).replace(/\/+$/, ""),
  };
}

/** 未設定の環境変数名。画面の案内に使う（値そのものは出さない）。 */
export function missingNotionConfigKeys(env: EnvLike = process.env): string[] {
  return NOTION_REQUIRED_ENV_KEYS.filter((key) => value(env, key) === "");
}
