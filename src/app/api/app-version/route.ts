import { NextResponse } from "next/server";

import { APP_VERSION } from "@/lib/app-version";

// CDN・ブラウザに保存されると稼働中の版を取り違えるため、常に動的に返す。
export const dynamic = "force-dynamic";

/**
 * 稼働しているコミットのSHA（#151）。`deploy.yml`が`.env`へ書く`APP_COMMIT_SHA`を返す。
 *
 * デプロイのヘルスチェックは、これが今回のコミットと一致するまで成功にしない
 * （旧版がHTTP 200を返しているだけの状態を成功と見なさないため）。
 * proxyでは公開パス（`src/lib/supabase/public-paths.ts`）にしてあり、未ログインで読める。
 * 返すのはバージョンとSHAだけで、利用者・在庫の情報は含めない。ローカル開発など未設定ならnull。
 */
export async function GET() {
  return NextResponse.json(
    { version: APP_VERSION, sha: process.env.APP_COMMIT_SHA || null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
