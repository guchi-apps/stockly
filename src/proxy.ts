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

// proxyを通さないのは、未ログインでもそのまま返す必要がある**実在する公開ファイル**だけ。
// PWAのmanifestとアイコンは、通すとログアウト時に`/login`へのリダイレクト（HTML）が返り、
// MIMEタイプ違いで読み込みに失敗する。`.wasm`（バーコード読み取り器。#9）も同じ理由で外す
// （`public/zxing/`配下。中身は公開ライブラリの成果物）。
//
// **拡張子（`.png`等）で終わるパスを一括で外さない**（#103）。`/inventory/x.png`のような動的ルートも
// 外れてしまい、proxyが行う`x-stockly-supabase-user-id`の削除が走らず、詐称したヘッダーで
// 任意の利用者として動かせた。除外は完全一致（`$`付き）か、専用ディレクトリの前方一致だけにする。
// 公開ファイルを足すときはここへ1つずつ足し、`proxy-matcher.test.ts`にも足す。
export const config = {
  matcher: [
    "/((?!_next/static/|_next/image$|favicon\\.ico$|manifest\\.webmanifest$|icon\\.svg$|apple-icon\\.png$|icon-192\\.png$|icon-512\\.png$|zxing/[^/]+\\.wasm$).*)",
  ],
};
