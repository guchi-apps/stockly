/**
 * ログインしていなくても通すパス。ここ以外はすべて認証が要る。
 *
 * `/api/app-version`はデプロイのヘルスチェック（VPS内の`127.0.0.1`）が未ログインで叩くため公開する
 * （#151）。返すのはバージョンとコミットSHAだけ。公開パスでもproxyは通るので、
 * `x-stockly-supabase-user-id`の詐称除去はそのまま効く。
 */
export const PUBLIC_PATHS = [
  "/login",
  "/auth/signin",
  "/auth/callback",
  "/api/dev/login",
  "/api/app-version",
] as const;

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
