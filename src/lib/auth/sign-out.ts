/**
 * このアプリのセッションだけを破棄する。
 *
 * **Supabase Authの`signOut()`は引数なしだと`scope: "global"`で、同じユーザーの全アプリ・全端末の
 * refresh tokenを失効させる。** このプロジェクトは他アプリと共有のSupabaseプロジェクトを使うため、
 * Stocklyのログアウトが他アプリのログイン状態まで巻き込んでしまう（#86）。
 * `signOut()`は直接呼ばず、必ずこの関数を通す（`sign-out.test.ts`が直接呼びを検出する）。
 *
 * このファイルは`node`のテストから直接読まれるため`@/`エイリアスを使わず、Supabaseクライアントも
 * 必要な形だけを型で受ける。
 */

export type LocalSignOutClient = {
  auth: {
    signOut(options: { scope: "local" }): Promise<{ error: { message: string } | null }>;
  };
};

/** 失敗しても例外にはしない。呼び出し側はエラーを記録したうえで、そのままログイン画面へ戻す。 */
export async function signOutFromThisApp(
  supabase: LocalSignOutClient,
): Promise<{ error: { message: string } | null }> {
  return supabase.auth.signOut({ scope: "local" });
}
