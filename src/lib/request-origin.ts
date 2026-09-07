/**
 * リクエストが実際に来たオリジンを返す。
 *
 * `request.url`（`nextUrl.origin`）は、開発サーバーがlocalhost・LAN・sslip.io経由など
 * 複数のホスト名で到達可能なとき、ブラウザが送ったHostを反映せず既定のホスト名を返すことがある。
 * OAuthのリダイレクト先をそこから組むと、Supabaseに登録したURLと食い違って認証が失敗する。
 *
 * 受け取るのは`NextRequest`ではなく素の`Request`。ルートハンドラの引数は`Request`で、
 * ここで見ているのは`Request`にもある`headers`と`url`だけのため。
 */
export function getRequestOrigin(request: Request): string {
  const host = request.headers.get("host");
  if (!host) return new URL(request.url).origin;

  // 本番はApacheがTLSを終端してhttpで転送するため、プロトコルはX-Forwarded-Protoで判断する。
  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}
