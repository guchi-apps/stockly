import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { missingVisionConfigKeys, readVisionConfig } from "./config.ts";
import { MAX_OBSERVATIONS, OBSERVATION_TOOL, buildRequestBody, parseObservations } from "./client.ts";

/**
 * 画像を読むモデルとのやり取り（#11）。
 *
 * **モデルAPIには接続しない**（`docs/testing-strategy.md`の「AI候補」の行）。確かめるのは
 * 「送る形」と「返ってきたものをそのまま信じないこと」の2つ。
 */

const CONFIG = {
  apiKey: "dummy",
  model: "claude-opus-5",
  apiBaseUrl: "http://127.0.0.1:9999/v1",
  maxImages: 4,
  maxImageBytes: 1000,
  dailyLimit: 20,
};

function toolUse(input: unknown) {
  return { content: [{ type: "tool_use", name: OBSERVATION_TOOL.name, input }] };
}

describe("readVisionConfig", () => {
  it("APIキーが無ければnull（未設定でも画面は開く）", () => {
    assert.equal(readVisionConfig({}), null);
    assert.deepEqual(missingVisionConfigKeys({}), ["ANTHROPIC_API_KEY"]);
  });

  it("既定のモデルと上限を持つ", () => {
    const config = readVisionConfig({ ANTHROPIC_API_KEY: "k" });
    assert.equal(config?.model, "claude-opus-5");
    assert.equal(config?.maxImages, 4);
    assert.equal(config?.dailyLimit, 20);
  });

  it("環境変数で差し替えられる（入口はローカルのスタブへ向けられる）", () => {
    const config = readVisionConfig({
      ANTHROPIC_API_KEY: "k",
      STOCKLY_VISION_MODEL: "claude-sonnet-5",
      STOCKLY_VISION_API_BASE_URL: "http://127.0.0.1:4321/v1/",
      STOCKLY_VISION_DAILY_LIMIT: "3",
    });
    assert.equal(config?.model, "claude-sonnet-5");
    assert.equal(config?.apiBaseUrl, "http://127.0.0.1:4321/v1");
    assert.equal(config?.dailyLimit, 3);
  });

  it("上限に読めない値が入っていたら既定へ倒す（設定ミスで歯止めが消えないように）", () => {
    const config = readVisionConfig({ ANTHROPIC_API_KEY: "k", STOCKLY_VISION_DAILY_LIMIT: "0" });
    assert.equal(config?.dailyLimit, 20);
  });
});

describe("buildRequestBody", () => {
  const images = [
    { mediaType: "image/jpeg" as const, bytes: new Uint8Array([1, 2, 3]) },
    { mediaType: "image/png" as const, bytes: new Uint8Array([4, 5]) },
  ];

  it("画像を先に、指示を最後に並べる", () => {
    const body = buildRequestBody(CONFIG, "棚の写真です", images);
    const content = (body.messages as { content: { type: string }[] }[])[0].content;
    assert.deepEqual(
      content.map((block) => block.type),
      ["image", "image", "text"],
    );
  });

  it("画像はbase64で、形式もそのまま渡す", () => {
    const body = buildRequestBody(CONFIG, "x", images);
    const first = (body.messages as { content: Record<string, never>[] }[])[0].content[0] as unknown as {
      source: { media_type: string; data: string };
    };
    assert.equal(first.source.media_type, "image/jpeg");
    assert.equal(first.source.data, Buffer.from([1, 2, 3]).toString("base64"));
  });

  it("報告用のツールだけを渡し、モデルは設定のものを使う", () => {
    const body = buildRequestBody(CONFIG, "x", images);
    assert.equal(body.model, "claude-opus-5");
    assert.deepEqual((body.tools as { name: string }[]).map((tool) => tool.name), [
      "report_observations",
    ]);
  });
});

describe("parseObservations", () => {
  it("ツールの応答から観察を取り出す", () => {
    const result = parseObservations(
      toolUse({
        observations: [
          {
            label: " おいしい牛乳 ",
            barcode: "4902705-001234",
            confidence: 0.9,
            visibleCount: 2,
            remainingRatio: null,
            containerCount: null,
            note: null,
          },
        ],
      }),
    );

    assert.equal(result.length, 1);
    assert.equal(result[0].label, "おいしい牛乳");
    assert.equal(result[0].barcode, "4902705001234");
    assert.equal(result[0].visibleCount, 2);
  });

  it("範囲外の値は落とす（モデルの出力をそのまま使わない）", () => {
    const result = parseObservations(
      toolUse({
        observations: [
          { label: "a", confidence: 5, remainingRatio: 1.5, visibleCount: -3, containerCount: 1.5 },
        ],
      }),
    );

    assert.equal(result[0].confidence, 0);
    assert.equal(result[0].remainingRatio, null);
    assert.equal(result[0].visibleCount, null);
    assert.equal(result[0].containerCount, null);
  });

  it("名前が空の行は捨てる（照合の手がかりが無いため）", () => {
    const result = parseObservations(toolUse({ observations: [{ label: "  " }, { label: "水" }] }));
    assert.deepEqual(
      result.map((row) => row.label),
      ["水"],
    );
  });

  it("ツールを使わず文章で返してきた場合は0件（画面が「読み取れませんでした」を出す）", () => {
    assert.deepEqual(parseObservations({ content: [{ type: "text", text: "牛乳が見えます" }] }), []);
    assert.deepEqual(parseObservations(null), []);
    assert.deepEqual(parseObservations({ content: "壊れた応答" }), []);
  });

  it("件数の上限を超えて返ってきても、上限までしか使わない", () => {
    const many = Array.from({ length: MAX_OBSERVATIONS + 5 }, (_, index) => ({
      label: `商品${index}`,
      confidence: 0.5,
    }));
    assert.equal(parseObservations(toolUse({ observations: many })).length, MAX_OBSERVATIONS);
  });
});
