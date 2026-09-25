import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Next.jsはmatcherを静的な文字列リテラルでしか読めないため、proxy.tsの実物から取り出して検証する。
const source = readFileSync(new URL("./proxy.ts", import.meta.url), "utf8");
const literal = source.match(/matcher:\s*\[\s*"((?:[^"\\]|\\.)*)"/)?.[1];
assert.ok(literal, "proxy.tsのmatcherが読めない");
const pattern = new RegExp(`^${JSON.parse(`"${literal}"`)}$`);

const passesProxy = (path: string) => pattern.test(path);

test("実在する公開ファイルだけがproxyを通らない", () => {
  for (const path of [
    "/_next/static/chunks/a.js",
    "/_next/image",
    "/favicon.ico",
    "/manifest.webmanifest",
    "/icon.svg",
    "/apple-icon.png",
    "/icon-192.png",
    "/icon-512.png",
    "/zxing/zxing_reader-3.1.3.wasm",
  ]) {
    assert.equal(passesProxy(path), false, path);
  }
});

test("拡張子で終わる動的ルートもproxyを通る（ヘッダー詐称の除去が走る）", () => {
  for (const path of [
    "/inventory/x.png",
    "/intake/x.png",
    "/inventory/x.svg",
    "/x.wasm",
    "/a/icon.svg",
    "/icon.svg/x",
    "/icon",
    "/apple-icon",
    "/sw.js",
    "/zxing/../inventory/x.wasm",
    "/zxing/a/b.wasm",
    "/manifest.webmanifest/x",
  ]) {
    assert.equal(passesProxy(path), true, path);
  }
});

test("通常の画面はproxyを通る", () => {
  for (const path of ["/", "/inventory", "/login", "/api/inventory/revision"]) {
    assert.equal(passesProxy(path), true, path);
  }
});
