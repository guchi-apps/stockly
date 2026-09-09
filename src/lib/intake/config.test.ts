import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_INTAKE_MODEL,
  estimateBatchCostYen,
  estimateCostYen,
  isIntakeConfigured,
  readIntakeConfig,
  toIntakeModel,
} from "./config.ts";

describe("readIntakeConfig", () => {
  it("資格情報が1つも無ければnull（未設定でも画面は開ける）", () => {
    assert.equal(readIntakeConfig({}), null);
    assert.equal(readIntakeConfig({ ANTHROPIC_API_KEY: "   " }), null);
    assert.equal(isIntakeConfigured({}), false);
  });

  it("APIキーがあれば従量課金の資格情報として読む", () => {
    const config = readIntakeConfig({ ANTHROPIC_API_KEY: "sk-test" });
    assert.equal(config?.credential.kind, "apiKey");
    assert.equal(config?.credential.value, "sk-test");
  });

  it("APIキーが無いときだけBearerトークンを使う", () => {
    const token = readIntakeConfig({ ANTHROPIC_AUTH_TOKEN: "oauth-test" });
    assert.equal(token?.credential.kind, "authToken");

    // 両方あるときは常にAPIキー。実行のたびにどちらで課金されたかが変わると追えない。
    const both = readIntakeConfig({ ANTHROPIC_API_KEY: "sk-test", ANTHROPIC_AUTH_TOKEN: "oauth" });
    assert.equal(both?.credential.kind, "apiKey");
  });

  it("既定のモデルは環境変数で差し替えられる。知らない値は既定へ落とす", () => {
    assert.equal(readIntakeConfig({ ANTHROPIC_API_KEY: "k" })?.defaultModel, DEFAULT_INTAKE_MODEL);
    assert.equal(
      readIntakeConfig({ ANTHROPIC_API_KEY: "k", STOCKLY_AI_MODEL: "claude-opus-5" })?.defaultModel,
      "claude-opus-5",
    );
    assert.equal(
      readIntakeConfig({ ANTHROPIC_API_KEY: "k", STOCKLY_AI_MODEL: "gpt-4" })?.defaultModel,
      DEFAULT_INTAKE_MODEL,
    );
  });

  it("入口のURLは末尾のスラッシュを落とす（テスト用のスタブへ向けるため）", () => {
    const config = readIntakeConfig({ ANTHROPIC_API_KEY: "k", ANTHROPIC_BASE_URL: "http://127.0.0.1:9/" });
    assert.equal(config?.baseUrl, "http://127.0.0.1:9");
  });

  it("為替のレートが読めなければ既定へ落とす（0やマイナスを受け付けない）", () => {
    const bad = readIntakeConfig({ ANTHROPIC_API_KEY: "k", STOCKLY_AI_USD_JPY: "0" });
    assert.equal(bad?.usdJpy, 155);
    const good = readIntakeConfig({ ANTHROPIC_API_KEY: "k", STOCKLY_AI_USD_JPY: "160" });
    assert.equal(good?.usdJpy, 160);
  });
});

describe("toIntakeModel", () => {
  it("使えるモデルidだけを返す", () => {
    assert.equal(toIntakeModel("claude-haiku-4-5"), "claude-haiku-4-5");
    assert.equal(toIntakeModel(""), null);
    assert.equal(toIntakeModel("claude-opus-9"), null);
  });
});

describe("estimateCostYen", () => {
  it("入力と出力の単価を分けて数える", () => {
    // sonnet-5 は $2 / $10 per MTok。100万入力 = 2ドル = 310円（155円/ドル）。
    assert.equal(estimateCostYen({ inputTokens: 1_000_000, outputTokens: 0 }, "claude-sonnet-5", 155), 310);
    assert.equal(estimateCostYen({ inputTokens: 0, outputTokens: 1_000_000 }, "claude-sonnet-5", 155), 1550);
  });

  it("モデルによって単価が変わる", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 0 };
    assert.equal(estimateCostYen(usage, "claude-opus-5", 155), 775);
    assert.equal(estimateCostYen(usage, "claude-haiku-4-5", 155), 155);
  });

  it("切り上げる（上限の歯止めに使う値なので下振れさせない）", () => {
    const cost = estimateCostYen({ inputTokens: 1, outputTokens: 0 }, "claude-sonnet-5", 155);
    assert.ok(cost > 0, "1トークンでも0円にはしない");
    assert.equal(cost, 0.001);
  });

  it("負のトークン数を0として扱う", () => {
    assert.equal(estimateCostYen({ inputTokens: -100, outputTokens: 0 }, "claude-sonnet-5", 155), 0);
  });
});

describe("estimateBatchCostYen", () => {
  it("枚数が増えれば概算も増える", () => {
    const one = estimateBatchCostYen(1, "claude-sonnet-5", 155);
    const three = estimateBatchCostYen(3, "claude-sonnet-5", 155);
    assert.ok(three > one);
  });

  it("0枚でも1枚ぶんとして数える（0円と出して送れてしまうのを防ぐ）", () => {
    assert.equal(estimateBatchCostYen(0, "claude-sonnet-5", 155), estimateBatchCostYen(1, "claude-sonnet-5", 155));
  });
});
