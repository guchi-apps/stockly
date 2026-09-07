import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { isAllowedEmail } from "./allowed-emails.ts";

/**
 * 「Supabaseで認証できること」と「Stocklyを使ってよいこと」を分ける判定（#2）。
 * 特に、許可メール未設定のときに全員拒否になること（fail-closed）を守る。
 */

const original = process.env.ALLOWED_GOOGLE_EMAILS;

afterEach(() => {
  if (original === undefined) delete process.env.ALLOWED_GOOGLE_EMAILS;
  else process.env.ALLOWED_GOOGLE_EMAILS = original;
});

describe("許可メールが未設定なら全員拒否する（fail-closed）", () => {
  it("環境変数そのものが無いとき", () => {
    delete process.env.ALLOWED_GOOGLE_EMAILS;
    assert.equal(isAllowedEmail("owner@example.com"), false);
  });

  it("空文字・カンマだけ・空白だけのとき", () => {
    for (const value of ["", "   ", ",", " , , "]) {
      process.env.ALLOWED_GOOGLE_EMAILS = value;
      assert.equal(isAllowedEmail("owner@example.com"), false, `value=${JSON.stringify(value)}`);
    }
  });
});

describe("許可メールが設定されているとき", () => {
  it("一致すれば許可する", () => {
    process.env.ALLOWED_GOOGLE_EMAILS = "owner@example.com";
    assert.equal(isAllowedEmail("owner@example.com"), true);
  });

  it("大文字小文字と前後の空白は無視する", () => {
    process.env.ALLOWED_GOOGLE_EMAILS = " Owner@Example.com , family@example.com ";
    assert.equal(isAllowedEmail("OWNER@example.com"), true);
    assert.equal(isAllowedEmail("family@example.com"), true);
  });

  it("一覧に無いアカウントは拒否する", () => {
    process.env.ALLOWED_GOOGLE_EMAILS = "owner@example.com";
    assert.equal(isAllowedEmail("stranger@example.com"), false);
    // 部分一致で通らないこと（前方・後方に別の文字が付いた形）。
    assert.equal(isAllowedEmail("xowner@example.com"), false);
    assert.equal(isAllowedEmail("owner@example.com.evil.test"), false);
  });

  it("メールが取れていないときは拒否する", () => {
    process.env.ALLOWED_GOOGLE_EMAILS = "owner@example.com";
    assert.equal(isAllowedEmail(null), false);
    assert.equal(isAllowedEmail(undefined), false);
    assert.equal(isAllowedEmail(""), false);
  });
});
