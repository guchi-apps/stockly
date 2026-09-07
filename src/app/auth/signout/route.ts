import { NextResponse, type NextRequest } from "next/server";

import { DEV_LOGIN_COOKIE_NAME } from "@/lib/auth/dev-login";
import { getRequestOrigin } from "@/lib/request-origin";
import { createClient } from "@/lib/supabase/server";

/**
 * ログアウトする。
 *
 * フォームのPOSTで受ける。GETにしないのは、ブラウザやリンクの先読みで意図せず
 * ログアウトさせられることを避けるため。
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error("[stockly] ログアウトに失敗:", error.message);
  }

  // POSTのリダイレクトは303で返す。既定の307のままだとリダイレクト先へもPOSTされる。
  const response = NextResponse.redirect(new URL("/login", getRequestOrigin(request)), 303);

  // 開発用ログインで入っている場合はSupabaseのセッションが無いので、こちらも消す。
  response.cookies.delete(DEV_LOGIN_COOKIE_NAME);

  return response;
}
