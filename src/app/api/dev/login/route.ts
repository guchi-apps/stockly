import { NextResponse, type NextRequest } from "next/server";

import { resolveInternalPath } from "@/lib/auth/internal-path";
import { DEV_LOGIN_COOKIE_NAME, isDevLoginEnabled } from "@/lib/auth/dev-login";
import { getRequestOrigin } from "@/lib/request-origin";

/**
 * 開発用ログイン（GUIの無いsubpc・CIから画面とAPIを確認するための入口）。
 *
 * `pnpm db:seed:dev`が入れたダミー利用者のCookieを立てるだけで、実利用者のデータには
 * 到達しない。**本番では常に404**（`isDevLoginEnabled()`が`NODE_ENV=production`と
 * シークレット未設定の二重で偽になる）。
 *
 *   curl -s -c /tmp/c.txt -X POST http://localhost:28002/api/dev/login
 *   curl -s -b /tmp/c.txt http://localhost:28002/
 */
export async function POST(request: NextRequest) {
  if (!isDevLoginEnabled()) {
    return new NextResponse(null, { status: 404 });
  }

  const origin = getRequestOrigin(request);
  const next = resolveInternalPath(request.nextUrl.searchParams.get("next"));

  // POSTのリダイレクトをGETで追わせる（既定の307だとブラウザがPOSTのまま再送する）。
  const response = NextResponse.redirect(`${origin}${next}`, 303);

  response.cookies.set(DEV_LOGIN_COOKIE_NAME, process.env.CI_LOGIN_BYPASS_SECRET ?? "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });

  return response;
}
