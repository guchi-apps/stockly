import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

/**
 * 全リクエストの入口。認証の判定は`updateSession()`に置いている。
 *
 * Next.js 16では旧`middleware.ts`がこの`proxy.ts`に相当する。
 */
export default async function proxy(request: NextRequest) {
  return updateSession(request);
}

// PWAのmanifestとアイコンは、未ログインでもそのまま返す必要がある。ここを通すと
// ログアウト時に`/login`へのリダイレクト（HTML）が返り、MIMEタイプ違いで読み込みに失敗する。
//
// `.wasm`（バーコード読み取り器。#9）も同じ理由で外す。中身は公開ライブラリの成果物で
// 隠す必要がなく、通すと読み取りのたびにSupabaseへ往復するうえ、
// セッションが切れた瞬間にHTMLが返って`WebAssembly.instantiate`が原因の分かりにくい形で落ちる。
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|apple-icon|icon|.*\\.(?:svg|png|jpg|jpeg|webp|ico|wasm)$).*)",
  ],
};
