import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_HOME_PATH,
  resolveInternalPath,
  resolveInternalPathOr,
} from "./internal-path.ts";

/** ログイン後の戻り先で外部サイトへ飛ばされないこと（open redirectの防止・#2）。 */

describe("アプリ内のパスはそのまま使う", () => {
  it("`/`始まりのパスとクエリ・フラグメントを保つ", () => {
    assert.equal(resolveInternalPath("/"), "/");
    assert.equal(resolveInternalPath("/items"), "/items");
    assert.equal(resolveInternalPath("/items?location=pantry"), "/items?location=pantry");
    assert.equal(resolveInternalPath("/items#top"), "/items#top");
  });
});

describe("外部へ飛ばしうる値は既定の画面へ落とす", () => {
  const hostile = [
    // 絶対URL。
    "https://evil.example/steal",
    "http://evil.example",
    // プロトコル相対URL。`/`始まりに見えるが外部を指す。
    "//evil.example",
    "///evil.example",
    // バックスラッシュを`//`と解釈するブラウザがある。
    "/\\evil.example",
    "/\\/evil.example",
    // スキームを使うもの。
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    // `/`始まりでないもの。
    "items",
    "../admin",
  ];

  for (const value of hostile) {
    it(`${JSON.stringify(value)} を弾く`, () => {
      assert.equal(resolveInternalPath(value), DEFAULT_HOME_PATH);
    });
  }

  it("値が無いときも既定の画面へ落とす", () => {
    assert.equal(resolveInternalPath(null), DEFAULT_HOME_PATH);
    assert.equal(resolveInternalPath(undefined), DEFAULT_HOME_PATH);
    assert.equal(resolveInternalPath(""), DEFAULT_HOME_PATH);
  });
});

/** 画面ごとの戻り先（「キャンセル」のリンク・フォームの`redirectTo`）。 */
describe("resolveInternalPathOr", () => {
  it("アプリ内のパスはそのまま使う", () => {
    assert.equal(resolveInternalPathOr("/inventory/lot-1", "/inventory"), "/inventory/lot-1");
    assert.equal(resolveInternalPathOr("/disaster?tab=food", "/inventory"), "/disaster?tab=food");
  });

  it("外部へ飛ばしうる値は、ホームではなく呼び出し側の既定へ倒す", () => {
    for (const value of ["https://evil.example", "//evil.example", "/\\evil.example", "items"]) {
      assert.equal(resolveInternalPathOr(value, "/inventory"), "/inventory");
    }
  });

  it("値が無いときも既定へ倒す", () => {
    assert.equal(resolveInternalPathOr(null, "/inventory"), "/inventory");
    assert.equal(resolveInternalPathOr(undefined, "/inventory"), "/inventory");
    assert.equal(resolveInternalPathOr("", "/inventory"), "/inventory");
  });

  it("明示的に指定した`/`はホームのまま通す", () => {
    assert.equal(resolveInternalPathOr("/", "/inventory"), "/");
  });
});
