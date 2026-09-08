import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getRequestOrigin } from "./request-origin.ts";

/**
 * OAuthのredirect_toを組み立てる土台（#34）。
 * 公開ホスト名で`http://`を組むと、SupabaseのRedirect URLsと一致せずSite URLへ飛ばされる。
 */

function requestWith(headers: Record<string, string>, url = "http://127.0.0.1:3116/auth/signin") {
  return new Request(url, { headers });
}

describe("公開ホスト名は必ずhttpsにする", () => {
  it("X-Forwarded-Protoがhttpでもhttpsを返す（certbotが:443へ複製した設定の対策）", () => {
    const request = requestWith({
      host: "stockly.gucchii.com",
      "x-forwarded-proto": "http",
    });
    assert.equal(getRequestOrigin(request), "https://stockly.gucchii.com");
  });

  it("X-Forwarded-Protoが無くてもhttpsを返す", () => {
    assert.equal(getRequestOrigin(requestWith({ host: "stockly.gucchii.com" })), "https://stockly.gucchii.com");
  });
});

describe("ローカル開発のホスト名はヘッダーどおりに扱う", () => {
  it("localhostはhttpのまま", () => {
    assert.equal(getRequestOrigin(requestWith({ host: "localhost:28034" })), "http://localhost:28034");
  });

  it("LANのIP・sslip.ioのホスト名もhttpのまま", () => {
    assert.equal(getRequestOrigin(requestWith({ host: "192.168.1.5:3000" })), "http://192.168.1.5:3000");
    assert.equal(
      getRequestOrigin(requestWith({ host: "192.168.1.5.sslip.io:3000" })),
      "http://192.168.1.5.sslip.io:3000",
    );
  });

  it("ローカルでもX-Forwarded-Protoがhttpsならhttpsを使う（トンネル経由）", () => {
    const request = requestWith({ host: "localhost:3000", "x-forwarded-proto": "https" });
    assert.equal(getRequestOrigin(request), "https://localhost:3000");
  });
});

describe("Hostヘッダーが無いときはリクエストURLのオリジンを使う", () => {
  it("Hostが無ければurlから組む", () => {
    const request = new Request("http://127.0.0.1:3116/auth/signin");
    request.headers.delete("host");
    assert.equal(getRequestOrigin(request), "http://127.0.0.1:3116");
  });
});
