/** ローカル開発でだけ使うホスト名か（ここだけは`http`のまま動かす）。 */
function isLocalDevHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  // LANの別端末から確認するときのホスト名（共有知見 knowledge/supabase.md）。
  if (hostname.endsWith(".sslip.io")) return true;
  // 生のIPアドレス（IPv6はHostヘッダーでは`[::1]`の形で来る）。
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith("[");
}

/** Hostヘッダーの値からポートを落とす。 */
function hostnameOf(host: string): string {
  if (host.startsWith("[")) return host.slice(0, host.indexOf("]") + 1);
  const colon = host.indexOf(":");
  return colon === -1 ? host : host.slice(0, colon);
}

/**
 * リクエストが実際に来たオリジンを返す。
 *
 * `request.url`（`nextUrl.origin`）は、開発サーバーがlocalhost・LAN・sslip.io経由など
 * 複数のホスト名で到達可能なとき、ブラウザが送ったHostを反映せず既定のホスト名を返すことがある。
 * OAuthのリダイレクト先をそこから組むと、Supabaseに登録したURLと食い違って認証が失敗する。
 *
 * **プロトコルは`X-Forwarded-Proto`を鵜呑みにしない**（#34）。certbotは`:80`のVirtualHostを
 * そのまま`:443`へ複製するため、`RequestHeader set X-Forwarded-Proto "http"`が残ったまま
 * HTTPSを終端していることがある。ヘッダーを信じると本番のOAuthのredirect_toが
 * `http://stockly.gucchii.com/auth/callback`になり、SupabaseのRedirect URLs（`https://`で
 * 登録）と一致せず、認証後にSite URL（`https://gucchii.com`）へ飛ばされる。
 * 公開ホスト名はApacheが`:80`を`:443`へ301で飛ばすので、ブラウザから見れば必ずHTTPS。
 * よってローカル開発のホスト名以外は`https`に固定し、ヘッダーはローカルでだけ見る。
 *
 * 受け取るのは`NextRequest`ではなく素の`Request`。ルートハンドラの引数は`Request`で、
 * ここで見ているのは`Request`にもある`headers`と`url`だけのため。
 */
export function getRequestOrigin(request: Request): string {
  const host = request.headers.get("host");
  if (!host) return new URL(request.url).origin;

  if (!isLocalDevHostname(hostnameOf(host))) return `https://${host}`;

  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}
