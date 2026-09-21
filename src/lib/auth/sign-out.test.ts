import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { signOutFromThisApp, type LocalSignOutClient } from "./sign-out.ts";

/**
 * ログアウトが共有Supabaseの他アプリのセッションを巻き込まないこと（#86）。
 * `signOut()`は引数なしだと`scope: "global"`になり、同じユーザーの全アプリのrefresh tokenを失効させる。
 */

function recordingClient(result: { error: { message: string } | null } = { error: null }) {
  const calls: unknown[][] = [];
  const client: LocalSignOutClient = {
    auth: {
      signOut: async (...args: unknown[]) => {
        calls.push(args);
        return result;
      },
    },
  };
  return { client, calls };
}

describe("signOutFromThisApp", () => {
  it("scope: \"local\" を渡して、このアプリのセッションだけを破棄する", async () => {
    const { client, calls } = recordingClient();

    await signOutFromThisApp(client);

    assert.deepEqual(calls, [[{ scope: "local" }]]);
  });

  it("Supabaseのエラーは例外にせず、そのまま返す", async () => {
    const { client } = recordingClient({ error: { message: "network" } });

    const { error } = await signOutFromThisApp(client);

    assert.equal(error?.message, "network");
  });
});

describe("signOut()の直接呼び出しを禁止する", () => {
  it("src配下でauth.signOut(...)を呼ぶのはsign-out.tsだけ", () => {
    const offenders = listSourceFiles("src")
      .filter((path) => !path.endsWith("sign-out.ts"))
      .filter((path) => /\.auth\s*\.\s*signOut\s*\(/.test(readFileSync(path, "utf8")));

    assert.deepEqual(
      offenders,
      [],
      "auth.signOut()は引数なしだとglobalで他アプリのセッションまで失効する。signOutFromThisApp()を使う",
    );
  });
});

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}
