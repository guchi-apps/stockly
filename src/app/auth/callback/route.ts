import { NextResponse, type NextRequest } from "next/server";

import { isAllowedEmail } from "@/lib/auth/allowed-emails";
import { resolveGoogleSubject } from "@/lib/auth/account-link";
import { resolveInternalPath } from "@/lib/auth/internal-path";
import { signOutFromThisApp } from "@/lib/auth/sign-out";
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
    // 許可外のユーザーでも、同じアカウントで他アプリにログインしているかもしれない。
    // このアプリのセッションだけを捨てる（globalだと他アプリまで失効する）。
    await signOutFromThisApp(supabase);
    return NextResponse.redirect(`${origin}/login?error=not_allowed`);
  }

  const metadata = user.user_metadata as Record<string, unknown>;

  // 本人の照合（#134）に使うGoogleのidは`identities`から取る。`user_metadata`は本人が書き換え
  // られるので、名前・画像の表示用にしか使わない。
  let result;
  try {
    result = await ensureStocklyUser({
      supabaseUserId: user.id,
      googleSubject: resolveGoogleSubject(user.identities),
      email: user.email ?? null,
      name: asString(metadata.full_name) ?? asString(metadata.name),
      imageUrl: asString(metadata.avatar_url) ?? asString(metadata.picture),
    });
  } catch (cause) {
    // 例外にはメールなどの個人情報が含まれうるので、種類だけを残す。
    console.error("[stockly] 利用者の用意に失敗:", errorName(cause));
    await signOutFromThisApp(supabase);
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  if (result.status === "recovery_required") {
    // 新しい利用者・家庭は作っていない。照合のために、どのSupabaseユーザーで止まったかだけを残す
    // （メールは残さない）。復旧の手順は docs/account-recovery.md。
    console.warn(
      `[stockly] 既存の利用者と照合できないため復旧が必要: reason=${result.reason} supabaseUserId=${user.id}`,
    );
    await signOutFromThisApp(supabase);
    return NextResponse.redirect(`${origin}/login?error=account_recovery`);
  }

  if (result.outcome === "relink") {
    console.info(`[stockly] 認証idの変更を検出し、既存の利用者へ付け替えた: userId=${result.userId}`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}

/** user_metadataの中身はプロバイダ任せなので、文字列以外はnullとして扱う。 */
function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function errorName(cause: unknown): string {
  const code = (cause as { code?: unknown } | null)?.code;
  const name = cause instanceof Error ? cause.name : typeof cause;
  return typeof code === "string" ? `${name}(${code})` : name;
}
