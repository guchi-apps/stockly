/**
 * Notion APIへの最小限の呼び出し。
 *
 * 使うのは「ページを作る」と「ページを更新する」の2つだけで、買い物リストの読み取りは行わない。
 * **Notion側の完了・編集をStocklyへ読み戻さない**（#6の受入条件）という分担を、
 * 呼べる操作の側からも狭めておくため。インテグレーションに要る権限も、この2つで足りる。
 *
 * 依存は足していない（`fetch`で直接叩く）。SDKを入れても使うのは同じ2つのエンドポイントで、
 * バージョン追従の手間だけが増えるため。
 */
import type { NotionConfig } from "./config.ts";

/** APIのバージョンは固定する。上げるときは、送っているプロパティの形も確かめること。 */
const NOTION_VERSION = "2022-06-28";

/** 1リクエストの待ち時間。Notionが詰まったときに画面を待たせ続けない。 */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * 連続で送るときの間隔。Notionのレート制限は平均3リクエスト/秒なので、
 * 1件ずつ順に送り、その間にこれだけ空ける（複数件の送信でも上限に触れない）。
 */
export const SEND_INTERVAL_MS = 400;

/** Notionへ送る買い物リストの1項目。 */
export interface ShoppingListItemInput {
  /** 品名。Notionのタイトルになる。 */
  readonly name: string;
  /** 「11.6ロール」のような、不足量の表示。 */
  readonly quantityText: string;
  /** Stockly側の対応ID。同じ候補を送り直したことが人にも分かるように入れる。 */
  readonly sourceId: string;
}

export interface NotionPageRef {
  readonly pageId: string;
  readonly url: string | null;
}

/** Notionへ送れなかったことを表す。`message`はそのまま画面に出すので、トークンを含めない。 */
export class NotionRequestError extends Error {
  /** HTTPのステータス。接続できなかった場合はnull。 */
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "NotionRequestError";
    this.status = status;
  }
}

/**
 * Notionのプロパティの形へ組み立てる。
 *
 * プロパティ名はデータベースごとに違うため設定値にしてある（既定は「名前」）。
 * 設定されていない任意のプロパティは送らない（存在しないプロパティを送るとAPIが400を返す）。
 */
export function buildPageProperties(
  config: NotionConfig,
  item: ShoppingListItemInput,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    [config.titleProperty]: { title: [{ text: { content: truncate(item.name, 200) } }] },
  };

  if (config.quantityProperty) {
    properties[config.quantityProperty] = {
      rich_text: [{ text: { content: truncate(item.quantityText, 200) } }],
    };
  }
  if (config.sourceProperty) {
    properties[config.sourceProperty] = {
      rich_text: [{ text: { content: truncate(item.sourceId, 200) } }],
    };
  }

  return properties;
}

/**
 * 買い物リストの項目を作る、または既にあるページを更新する。
 *
 * `existingPageId`があるときは**新しいページを作らずにそれを更新する**。これが
 * 「同じ候補を送り直してもNotionの項目が重複しない」ことの実体で、Stockly側は
 * `ShoppingListEntry.notionPageId`にこの値を持ち続ける。
 *
 * 例外として、Notionでそのページが消されていた場合（404）だけ作り直す。
 * 消えたページを更新し続けても買い物リストには何も出ないため。
 */
export async function upsertShoppingListItem(
  config: NotionConfig,
  item: ShoppingListItemInput,
  existingPageId: string | null,
): Promise<NotionPageRef> {
  const properties = buildPageProperties(config, item);

  if (existingPageId) {
    try {
      return await request(config, "PATCH", `/pages/${existingPageId}`, { properties });
    } catch (error) {
      // 404（消された）以外は、作り直すと項目が増えてしまうのでそのまま失敗させる。
      if (!(error instanceof NotionRequestError) || error.status !== 404) throw error;
    }
  }

  return request(config, "POST", "/pages", {
    parent: { database_id: config.databaseId },
    properties,
  });
}

async function request(
  config: NotionConfig,
  method: "POST" | "PATCH",
  path: string,
  body: unknown,
): Promise<NotionPageRef> {
  let response: Response;
  try {
    response = await fetch(`${config.apiBaseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // 接続できなかった場合。ここで在庫は何も変えていないので、戻す処理は要らない。
    throw new NotionRequestError(
      `Notionに接続できませんでした（${error instanceof Error ? error.name : "unknown"}）。時間をおいて送り直してください。`,
    );
  }

  const payload = await readJson(response);

  if (!response.ok) {
    throw new NotionRequestError(describeFailure(response.status, payload), response.status);
  }

  const pageId = typeof payload?.id === "string" ? payload.id : null;
  if (!pageId) {
    throw new NotionRequestError("Notionの応答からページを特定できませんでした。", response.status);
  }
  return { pageId, url: typeof payload?.url === "string" ? payload.url : null };
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
 * Notionの`message`は原因の特定に要るのでそのまま添えるが、長さは切り詰める。
 * リクエストの中身（トークンを含むヘッダー）はここへ出さない。
 */
function describeFailure(status: number, payload: Record<string, unknown> | null): string {
  const detail = typeof payload?.message === "string" ? truncate(payload.message, 300) : "";

  if (status === 401 || status === 403) {
    return `Notionへの権限がありません（${status}）。インテグレーションを買い物リストのデータベースへ招待しているか確かめてください。${detail}`;
  }
  if (status === 404) {
    return `Notionの送り先が見つかりません（404）。データベースidの設定を確かめてください。${detail}`;
  }
  if (status === 429) {
    return "Notionのレート制限に達しました（429）。少し待ってから送り直してください。";
  }
  if (status >= 500) {
    return `Notion側で失敗しました（${status}）。時間をおいて送り直してください。`;
  }
  return `Notionが受け付けませんでした（${status}）。${detail}`;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
