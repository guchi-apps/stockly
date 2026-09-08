import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildPageProperties } from "./client.ts";
import { missingNotionConfigKeys, readNotionConfig, type NotionConfig } from "./config.ts";

const CONFIG: NotionConfig = {
  token: "secret-for-test",
  databaseId: "database-1",
  titleProperty: "名前",
  quantityProperty: null,
  sourceProperty: null,
  apiBaseUrl: "https://api.notion.com/v1",
};

describe("readNotionConfig", () => {
  it("トークンとデータベースidが揃っていなければnull（未設定でも画面は開ける）", () => {
    assert.equal(readNotionConfig({}), null);
    assert.equal(readNotionConfig({ NOTION_API_TOKEN: "t" }), null);
    assert.equal(readNotionConfig({ NOTION_API_TOKEN: " ", NOTION_SHOPPING_DATABASE_ID: "d" }), null);
  });

  it("揃っていれば既定値で埋めて返す", () => {
    const config = readNotionConfig({
      NOTION_API_TOKEN: "t",
      NOTION_SHOPPING_DATABASE_ID: "d",
    });

    assert.equal(config?.titleProperty, "名前");
    assert.equal(config?.quantityProperty, null);
    assert.equal(config?.apiBaseUrl, "https://api.notion.com/v1");
  });

  it("プロパティ名とAPIの入口は設定で差し替えられる", () => {
    const config = readNotionConfig({
      NOTION_API_TOKEN: "t",
      NOTION_SHOPPING_DATABASE_ID: "d",
      NOTION_SHOPPING_TITLE_PROPERTY: "品名",
      NOTION_SHOPPING_QUANTITY_PROPERTY: "数量",
      NOTION_SHOPPING_SOURCE_PROPERTY: "対応ID",
      NOTION_API_BASE_URL: "http://127.0.0.1:9999/v1/",
    });

    assert.equal(config?.titleProperty, "品名");
    assert.equal(config?.quantityProperty, "数量");
    assert.equal(config?.sourceProperty, "対応ID");
    // 末尾のスラッシュは落として、パスの二重スラッシュを作らない。
    assert.equal(config?.apiBaseUrl, "http://127.0.0.1:9999/v1");
  });
});

describe("missingNotionConfigKeys", () => {
  it("未設定の環境変数名だけを返す（値は返さない）", () => {
    assert.deepEqual(missingNotionConfigKeys({ NOTION_API_TOKEN: "t" }), [
      "NOTION_SHOPPING_DATABASE_ID",
    ]);
    assert.deepEqual(
      missingNotionConfigKeys({ NOTION_API_TOKEN: "t", NOTION_SHOPPING_DATABASE_ID: "d" }),
      [],
    );
  });
});

describe("buildPageProperties", () => {
  const item = { name: "トイレットペーパー", quantityText: "11.6ロール", sourceId: "stockly:e1" };

  it("設定されていない任意のプロパティは送らない（存在しないプロパティは400になる）", () => {
    const properties = buildPageProperties(CONFIG, item);

    assert.deepEqual(Object.keys(properties), ["名前"]);
    assert.deepEqual(properties["名前"], {
      title: [{ text: { content: "トイレットペーパー" } }],
    });
  });

  it("数量と対応IDは、設定された名前のテキストプロパティへ入れる", () => {
    const properties = buildPageProperties(
      { ...CONFIG, quantityProperty: "数量", sourceProperty: "対応ID" },
      item,
    );

    assert.deepEqual(properties["数量"], { rich_text: [{ text: { content: "11.6ロール" } }] });
    assert.deepEqual(properties["対応ID"], { rich_text: [{ text: { content: "stockly:e1" } }] });
  });

  it("長すぎる品名は切り詰める", () => {
    const properties = buildPageProperties(CONFIG, { ...item, name: "あ".repeat(500) });
    const title = properties["名前"] as { title: { text: { content: string } }[] };

    assert.equal(title.title[0].text.content.length, 200);
    assert.ok(title.title[0].text.content.endsWith("…"));
  });
});
