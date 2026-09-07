import { timingSafeEqual } from "node:crypto";

/**
 * GUIの無いsubpc・CIから、ログインの背後にある画面とAPIを確認するための開発用ログイン。
 *
 * Google OAuthは外部サイトでの対話的な同意を必ず経由するため、SSH越しのtmuxやCIの無人実行では
 * ログインを完了できない。「認証を突破する」のではなく、開発・CI限定の入口を用意する
 * （auth-dev-login skill / guchi-apps/issue-deck#1473・#1656）。
 *
 * **本番では二重に無効化する。**
 * 1. `NODE_ENV === "production"` なら常に無効
 * 2. `CI_LOGIN_BYPASS_SECRET` が未設定なら無効
 *
 * 片方だけを緩めてはいけない。本番の`.env`にシークレットを入れない運用と、コード側の
 * 環境判定の、どちらが破れても素通しにならないようにするための二重化である。
 *
 * 名前をフリート共通の`ci-login-bypass` / `CI_LOGIN_BYPASS_SECRET`に揃えているのは、
 * 他アプリと同じ手順（auth-dev-login skill）でそのまま検証できるようにするため。
 */
export const DEV_LOGIN_COOKIE_NAME = "ci-login-bypass";

/**
 * 開発用ログインで入るダミー利用者の`supabaseUserId`。
 * `scripts/seed-dev.mjs`がこのIDでUser・Household・HouseholdMemberを作る。
 * 実利用者のデータには紐づかない。
 */
export const DEV_LOGIN_SUPABASE_USER_ID = "dev-login-bot";

/** 開発用ログインを有効にしてよい環境か。ログイン画面にボタンを出すかの判定にも使う。 */
export function isDevLoginEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return (process.env.CI_LOGIN_BYPASS_SECRET ?? "").length > 0;
}

/** 長さの違いで先に落とすため、比較の前に長さを見る（timingSafeEqualは同長しか受け取れない）。 */
function safeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return timingSafeEqual(aBuffer, bBuffer);
}

/**
 * 開発用ログインのCookieとして正しいなら、そのダミー利用者の`supabaseUserId`を返す。
 * 無効な環境・値が違う場合はnull。
 *
 * proxyと`getCurrentUser()`の両方がこの関数を呼ぶ。判定がどちらか一方にしか無いと、
 * proxyは通るのに利用者を解決できず画面が空になる（auth-dev-login skill）。
 */
export function resolveDevLoginUserId(cookieValue: string | undefined): string | null {
  if (!isDevLoginEnabled()) return null;
  if (!cookieValue) return null;
  if (!safeEqual(cookieValue, process.env.CI_LOGIN_BYPASS_SECRET ?? "")) return null;
  return DEV_LOGIN_SUPABASE_USER_ID;
}
