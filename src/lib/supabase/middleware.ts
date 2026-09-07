import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { SUPABASE_USER_ID_HEADER } from "@/lib/auth/auth-header";
import { DEV_LOGIN_COOKIE_NAME, resolveDevLoginUserId } from "@/lib/auth/dev-login";
import { getRequestOrigin } from "@/lib/request-origin";

/** ログインしていなくても通すパス。ここ以外はすべて認証が要る。 */
const PUBLIC_PATHS = ["/login", "/auth/signin", "/auth/callback", "/api/dev/login"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * Supabaseのセッションを更新し、検証済みの利用者を後段へ渡す（`src/proxy.ts`から呼ばれる）。
 *
 * ここが認証の唯一の関門で、次の3つを担う。
 *
 * 1. Cookieに入っているセッションの更新（`getUser()`が必要に応じてリフレッシュする）
 * 2. 未ログインのアクセスを`/login`へ戻す（`/api/*`はJSONの401）
 * 3. 検証済みのSupabaseユーザーIDを`SUPABASE_USER_ID_HEADER`で後段へ渡す
 *
 * 3のおかげで、画面・APIは`getUser()`を呼び直さずに`getCurrentUser()`だけで済む。
 * ヘッダーはログインの有無にかかわらず**必ず上書きか削除をする**ので、クライアントが
 * 同名のヘッダーを詐称して送ってきても後段には届かない。
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const requestHeaders = new Headers(request.headers);

  // 詐称対策。以降の分岐でログイン済みと分かったときだけ入れ直す。
  requestHeaders.delete(SUPABASE_USER_ID_HEADER);

  // 開発用ログイン。本番では`resolveDevLoginUserId()`が常にnullを返すため、この分岐は成立しない。
  const devLoginUserId = resolveDevLoginUserId(
    request.cookies.get(DEV_LOGIN_COOKIE_NAME)?.value,
  );
  if (devLoginUserId) {
    // ログイン済みで`/login`を開いたときの扱いは、Supabaseのセッションで入っている場合と揃える。
    if (pathname === "/login") {
      return NextResponse.redirect(new URL("/", getRequestOrigin(request)));
    }
    requestHeaders.set(SUPABASE_USER_ID_HEADER, devLoginUserId);
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // セッション更新でSupabaseが発行したCookieは、最終的に返すレスポンスへ必ず載せる必要がある。
  // 素通しとリダイレクトのどちらを返すかは利用者の有無を見てからでないと決まらないので、
  // ここではいったん溜め、レスポンスを組み立てる時点でまとめて付ける。
  const refreshedCookies: { name: string; value: string; options: CookieOptions }[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          refreshedCookies.push(...cookiesToSet);
        },
      },
    },
  );

  // `getUser()`はSupabaseへ往復してトークンを検証する。届かなかったときの戻り値は未ログインと
  // 同じ`user: null`なので、errorを見ないと「セッションが無い」と「今は確認できない」を取り違える。
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  const withRefreshedCookies = <T extends NextResponse>(response: T): T => {
    refreshedCookies.forEach(({ name, value, options }) =>
      response.cookies.set(name, value, options),
    );
    return response;
  };

  if (user) {
    requestHeaders.set(SUPABASE_USER_ID_HEADER, user.id);
  }

  const proceed = () =>
    withRefreshedCookies(NextResponse.next({ request: { headers: requestHeaders } }));

  // ログイン済みで`/login`を開いた場合（ブラウザの「戻る」等）はログイン画面を出さず、
  // ログイン後の画面へ送る。
  if (pathname === "/login" && user) {
    return withRefreshedCookies(
      NextResponse.redirect(new URL("/", getRequestOrigin(request))),
    );
  }

  if (isPublicPath(pathname)) {
    return proceed();
  }

  // 通信不達・5xx・レート制限。セッションが無効になったわけではないので、ログイン画面へは戻さない。
  // ここで`/login`へ戻すと、有効なセッションを持つ利用者が電波の悪い場所で開いただけで
  // ログインし直すことになる。
  if (isAuthUnreachable(error)) {
    console.error(
      `[stockly] Supabase Authへ到達できずセッションを確認できない: ${pathname} ${error?.status ?? ""} ${error?.message ?? ""}`,
    );
    return withRefreshedCookies(serviceUnavailable(pathname));
  }

  if (!user) {
    // APIはリダイレクトすると呼び出し側がHTMLを受け取ってしまうため、401のJSONで返す。
    if (pathname.startsWith("/api/")) {
      return withRefreshedCookies(
        NextResponse.json(
          { error: "ログインが必要です。" },
          { status: 401, headers: { "Cache-Control": "no-store" } },
        ),
      );
    }

    const loginUrl = new URL("/login", getRequestOrigin(request));
    // 戻り先はパスだけを渡す。オリジンごと渡すと、そのまま外部URLを差し込まれうる。
    loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return withRefreshedCookies(NextResponse.redirect(loginUrl));
  }

  return proceed();
}

/**
 * 「セッションが無効」ではなく「今は確認できなかった」ことを示すエラーか。
 *
 * auth-jsは通信不達とHTTP 5xxを`AuthRetryableFetchError`（通信不達はstatus 0）で返す。
 * 判定関数`isAuthRetryableFetchError()`は`@supabase/supabase-js`から再公開されておらず、
 * auth-jsを直接の依存に加えたくないため、同じ判定をここに置く。
 * レート制限(429)も同じ扱いにする。時間をおけば通るもので、ログアウトさせる理由がない。
 */
function isAuthUnreachable(error: { name: string; status?: number } | null): boolean {
  if (!error) return false;
  return error.name === "AuthRetryableFetchError" || error.status === 429;
}

/** ログイン状態を確認できなかったことを伝える応答。401にしないのは、ログアウトと解釈させないため。 */
function serviceUnavailable(pathname: string): NextResponse {
  const headers = { "Retry-After": "5", "Cache-Control": "no-store" };

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "ログイン状態を確認できませんでした。通信状況を確認してもう一度お試しください。" },
      { status: 503, headers },
    );
  }

  return new NextResponse(
    `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Stockly</title>
  </head>
  <body style="font-family: system-ui, sans-serif; display: grid; place-items: center; height: 100dvh; margin: 0; text-align: center;">
    <div>
      <p>ログイン状態を確認できませんでした。</p>
      <p>通信状況を確認して、もう一度お試しください。</p>
      <p><a href="">再読み込み</a></p>
    </div>
  </body>
</html>
`,
    { status: 503, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } },
  );
}
