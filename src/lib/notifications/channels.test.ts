import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseChannelKeys, resolveChannels } from "./channels.ts";

describe("parseChannelKeys", () => {
  it("カンマ区切りで複数の送り先を受け取る", () => {
    assert.deepEqual(parseChannelKeys("IN_APP,LOG"), ["IN_APP", "LOG"]);
    assert.deepEqual(parseChannelKeys(" in_app , log "), ["IN_APP", "LOG"]);
  });

  it("未設定・空文字なら既定（アプリ内のお知らせ）に戻す", () => {
    assert.deepEqual(parseChannelKeys(undefined), ["IN_APP"]);
    assert.deepEqual(parseChannelKeys("  "), ["IN_APP"]);
  });

  it("知らない名前は落とす。全部知らない名前なら既定に戻す", () => {
    assert.deepEqual(parseChannelKeys("LOG,SLACK"), ["LOG"]);
    assert.deepEqual(parseChannelKeys("SLACK,LINE"), ["IN_APP"]);
  });

  it("同じ名前を並べても二重に送らない", () => {
    assert.deepEqual(parseChannelKeys("LOG,LOG"), ["LOG"]);
  });
});

describe("resolveChannels", () => {
  it("設定した順ではなく、実装のある送り先だけを返す", () => {
    const channels = resolveChannels("IN_APP,LOG");
    assert.deepEqual(
      channels.map((channel) => channel.key),
      ["IN_APP", "LOG"],
    );
    assert.equal(channels[0].label, "アプリ内のお知らせ");
  });

  it("送り先はすべて同じ形（key・label・send）を持つ", () => {
    for (const channel of resolveChannels("IN_APP,LOG")) {
      assert.equal(typeof channel.key, "string");
      assert.equal(typeof channel.label, "string");
      assert.equal(typeof channel.send, "function");
    }
  });
});
