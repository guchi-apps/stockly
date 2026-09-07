/** ログイン後の既定の着地点。PWAの`start_url`（src/app/manifest.ts）と揃える。 */
export const DEFAULT_HOME_PATH = "/";

/**
 * ログイン後の戻り先（`next` / `callbackUrl`）を、外部サイトへ飛ばされない形に正す。
 *
 * 攻撃者が`?next=https://evil.example`を付けたログインURLを踏ませると、ログイン直後に
 * 外部サイトへ送られる（open redirect）。`/`始まりだけを通し、**`//`始まりは弾く**。
 * `//evil.example`はプロトコル相対URLで、`/`始まりに見えて外部を指すため。
 * `/\`（バックスラッシュ）も一部のブラウザが`//`と同じに解釈するので同様に弾く。
 *
 * 判定を1か所へ置くのは、`/auth/signin`・`/auth/callback`・`/login`・proxyの4経路で
 * 同じ規則を使う必要があるため。
 */
export function resolveInternalPath(param: string | null | undefined): string {
  if (!param) return DEFAULT_HOME_PATH;
  if (!param.startsWith("/")) return DEFAULT_HOME_PATH;
  if (param.startsWith("//") || param.startsWith("/\\")) return DEFAULT_HOME_PATH;
  return param;
}
