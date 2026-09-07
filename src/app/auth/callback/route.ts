import { NextResponse, type NextRequest } from "next/server";

import { isAllowedEmail } from "@/lib/auth/allowed-emails";
import { resolveInternalPath } from "@/lib/auth/internal-path";
import { ensureStocklyUser } from "@/lib/household/provisioning";
import { getRequestOrigin } from "@/lib/request-origin";
import { createClient } from "@/lib/supabase/server";

/**
 * Google OAuthのコールバック。認可コードをセッションに交換し、Stockly側の利用者を用意する。
 *
 * **Supabaseで認証できることと、Stocklyを使ってよいことは別**（共有のSupabaseプロジェクトを
 * 他アプリと使っているため）。ここで`isAllowedEmail()`を通し、許可外なら利用者を作らずに
 * Supabaseのセッションも破棄する。
 */
export async function GET(request: NextRequest) {
  const origin = getRequestOrigin(request);
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  // 戻り先はここでも正規化する。`/auth/signin`を経由せず直接叩かれても外部へ飛ばさないため。
  const next = resolveInternalPath(searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    console.error("[stockly] セッションの交換に失敗:", error?.message ?? "ユーザーが返らなかった");
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  const { user } = data;

  if (!isAllowedEmail(user.email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=not_allowed`);
  }

  const metadata = user.user_metadata as Record<string, unknown>;

  await ensureStocklyUser({
    supabaseUserId: user.id,
    email: user.email ?? null,
    name: asString(metadata.full_name) ?? asString(metadata.name),
    imageUrl: asString(metadata.avatar_url) ?? asString(metadata.picture),
  });

  return NextResponse.redirect(`${origin}${next}`);
}

/** user_metadataの中身はプロバイダ任せなので、文字列以外はnullとして扱う。 */
function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
