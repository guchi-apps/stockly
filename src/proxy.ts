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
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|apple-icon|icon|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)",
  ],
};
