import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { isDevLoginEnabled, resolveDevLoginUserId, DEV_LOGIN_SUPABASE_USER_ID } from "./dev-login.ts";

/**
 * 開発用ログインが本番で二重に無効化されていること（#2）。
 * `NODE_ENV=production`とシークレット未設定の、どちらか一方が破れても素通しにならないことを見る。
 */

const SECRET = "0123456789abcdef0123456789abcdef";

const originalNodeEnv = process.env.NODE_ENV;
const originalSecret = process.env.CI_LOGIN_BYPASS_SECRET;

// process.env.NODE_ENV は型の上では読み取り専用のため、代入はReflect経由で行う。
function setEnv(key: string, value: string | undefined) {
  if (value === undefined) Reflect.deleteProperty(process.env, key);
  else Reflect.set(process.env, key, value);
}

afterEach(() => {
  setEnv("NODE_ENV", originalNodeEnv);
  setEnv("CI_LOGIN_BYPASS_SECRET", originalSecret);
});

describe("本番では常に無効", () => {
  it("シークレットが設定されていても、NODE_ENV=production なら無効", () => {
    setEnv("NODE_ENV", "production");
    setEnv("CI_LOGIN_BYPASS_SECRET", SECRET);

    assert.equal(isDevLoginEnabled(), false);
    assert.equal(resolveDevLoginUserId(SECRET), null);
  });
});

describe("シークレット未設定なら無効", () => {
  it("開発環境でもシークレットが無ければ無効", () => {
    setEnv("NODE_ENV", "development");
    setEnv("CI_LOGIN_BYPASS_SECRET", undefined);

    assert.equal(isDevLoginEnabled(), false);
    assert.equal(resolveDevLoginUserId(SECRET), null);
  });

  it("空文字のシークレットも無効（空Cookieで通らない）", () => {
    setEnv("NODE_ENV", "development");
    setEnv("CI_LOGIN_BYPASS_SECRET", "");

    assert.equal(isDevLoginEnabled(), false);
    assert.equal(resolveDevLoginUserId(""), null);
  });
});

describe("開発環境でシークレットが一致したときだけ通す", () => {
  it("一致すればダミー利用者のidを返す", () => {
    setEnv("NODE_ENV", "development");
    setEnv("CI_LOGIN_BYPASS_SECRET", SECRET);

    assert.equal(isDevLoginEnabled(), true);
    assert.equal(resolveDevLoginUserId(SECRET), DEV_LOGIN_SUPABASE_USER_ID);
  });

  it("値が違う・Cookieが無い場合は通さない", () => {
    setEnv("NODE_ENV", "development");
    setEnv("CI_LOGIN_BYPASS_SECRET", SECRET);

    assert.equal(resolveDevLoginUserId(undefined), null);
    assert.equal(resolveDevLoginUserId(""), null);
    assert.equal(resolveDevLoginUserId(`${SECRET}x`), null, "長さ違いで落ちること");
    assert.equal(resolveDevLoginUserId(SECRET.replace(/.$/, "0")), null, "同じ長さでも値が違えば落ちること");
  });
});
