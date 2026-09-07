import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** サーバーコンポーネント・ルートハンドラから使うSupabaseクライアント。 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Componentからは Cookie を書けない。セッションの更新は proxy.ts が担うため
            // ここは無視してよい。
          }
        },
      },
    },
  );
}
