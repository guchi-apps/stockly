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

/**
 * 戻り先を内部パスへ正し、弾かれた値は呼び出し側の既定へ倒す。
 *
 * `resolveInternalPath()`が弾いた値はホーム（`/`）になるが、画面の「戻る」「キャンセル」の
 * 行き先はホームより元の一覧（`/inventory`など）のほうが自然なので、既定を渡せる形にしてある。
 * 利用者が明示的に`/`を指定した場合だけは`/`のまま通す。
 *
 * **クエリパラメータやフォームから来た戻り先を使う画面は、この判定を書き写さずここを通すこと。**
 * 1か所でも素通しすると、そこだけがopen redirectの入口になる（#47のレビュー指摘）。
 * リンクの`href`に使う値も対象——サーバー側の`redirect()`だけを正しても、
 * 画面に置いたリンクからは外部へ出られる。
 */
export function resolveInternalPathOr(param: string | null | undefined, fallback: string): string {
  const path = resolveInternalPath(param);
  return path === DEFAULT_HOME_PATH && param !== DEFAULT_HOME_PATH ? fallback : path;
}
