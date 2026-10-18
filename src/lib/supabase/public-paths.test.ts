import assert from "node:assert/strict";
import { test } from "node:test";

import { isPublicPath } from "./public-paths.ts";

test("デプロイのヘルスチェックが叩く/api/app-versionは未ログインで通る（#151）", () => {
  assert.equal(isPublicPath("/api/app-version"), true);
});

test("ログインの入口は公開パス", () => {
  for (const path of ["/login", "/auth/signin", "/auth/callback", "/api/dev/login"]) {
    assert.equal(isPublicPath(path), true, path);
  }
});

test("前方一致の取り違えで在庫のAPIや画面を公開しない", () => {
  for (const path of [
    "/",
    "/inventory",
    "/api/inventory/revision",
    "/api/app-versions",
    "/api/app-version-x",
    "/api",
    "/loginx",
  ]) {
    assert.equal(isPublicPath(path), false, path);
  }
});
