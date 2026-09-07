import { NextResponse, type NextRequest } from "next/server";

import { resolveInternalPath } from "@/lib/auth/internal-path";
import { getRequestOrigin } from "@/lib/request-origin";
import { createClient } from "@/lib/supabase/server";

/**
 * Googleログインを開始する。
 *
 * ブラウザ側で`signInWithOAuth()`を呼ばず、サーバーで認可URLを組み立てて302を返す。
 * こうするとログインが素のリンクになり、クライアントJSのハイドレーションが終わる前でも押せる
 * （guchi-apps/dayspan、共有知見 knowledge/supabase.md）。
 * PKCEの検証値はサーバークライアントがCookieへ書き、`/auth/callback`が読む。
 */
export async function GET(request: NextRequest) {
  const origin = getRequestOrigin(request);
  const next = resolveInternalPath(request.nextUrl.searchParams.get("next"));

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      // ここではリダイレクトせずURLだけ受け取り、こちらで302を返す。
      skipBrowserRedirect: true,
    },
  });

  if (error || !data.url) {
    console.error(
      "[stockly] Googleログインの開始に失敗:",
      error?.message ?? "認可URLが返らなかった",
    );
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  return NextResponse.redirect(data.url);
}
