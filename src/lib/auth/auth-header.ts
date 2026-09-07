/**
 * `src/proxy.ts`が検証したSupabaseユーザーIDを、後段のページ・ルートハンドラへ渡すヘッダー。
 *
 * proxyはmatcherに一致するすべてのリクエストでこの値を**必ず上書きし、未ログインなら削除する**。
 * そのため、クライアントが同じ名前のヘッダーを詐称して送っても後段には届かない。
 * 逆に、proxyのmatcherから外したパスではこの前提が成り立たないことに注意する。
 */
export const SUPABASE_USER_ID_HEADER = "x-stockly-supabase-user-id";
