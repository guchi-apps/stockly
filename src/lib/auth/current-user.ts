import { cookies, headers } from "next/headers";

import { SUPABASE_USER_ID_HEADER } from "@/lib/auth/auth-header";
import { DEV_LOGIN_COOKIE_NAME, resolveDevLoginUserId } from "@/lib/auth/dev-login";
import { db } from "@/lib/db";
import {
  listAccessibleHouseholdIds,
  resolveDefaultHouseholdId,
} from "@/lib/household/access";
import { householdMembershipStore } from "@/lib/household/store";

/**
 * ログイン中の利用者を返す。
 *
 * **セッションの検証は`src/proxy.ts`が1リクエストにつき1回だけ行い、結果をヘッダーで渡してくる。**
 * ここで`supabase.auth.getUser()`を呼び直すと、Supabaseへの往復が1リクエストで2回になる
 * （`getUser()`は毎回Supabaseの`/user`へ問い合わせる）。画面やAPIから呼ぶのはこの関数で、
 * `getUser()`を直接呼ばないこと。
 *
 * proxyのmatcherから外れているパス（静的アセット等）からは使えない。
 */
export async function getCurrentUser() {
  const supabaseUserId = await resolveSupabaseUserId();
  if (!supabaseUserId) return null;

  return db.user.findUnique({ where: { supabaseUserId } });
}

/** ログイン中の利用者のStockly側id。未ログインならnull。 */
export async function getCurrentUserId(): Promise<string | null> {
  return (await getCurrentUser())?.id ?? null;
}

/**
 * ログイン中の利用者と、既定で見せる家庭をまとめて返す。
 *
 * 在庫を扱う画面・APIはここで得た`householdId`を`scopeToHousehold()`へ渡す。
 */
export async function getCurrentSession() {
  const user = await getCurrentUser();
  if (!user) return null;

  const householdIds = await listAccessibleHouseholdIds(householdMembershipStore, user.id);

  return {
    user,
    householdIds,
    householdId: householdIds[0] ?? null,
  };
}

/** 既定の家庭のid。所属が1つも無ければnull。 */
export async function getCurrentHouseholdId(): Promise<string | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  return resolveDefaultHouseholdId(householdMembershipStore, userId);
}

/**
 * このリクエストのSupabaseユーザーIDを解決する。
 *
 * 通常はproxyが書いたヘッダーを読むだけ。開発用ログインの判定も入れているのは、proxy側にしか
 * 判定が無いと「proxyは通るのに利用者を解決できず画面が空になる」ため（auth-dev-login skill）。
 * 判定の実体は`resolveDevLoginUserId()`1つで、本番では常にnullを返す。
 */
async function resolveSupabaseUserId(): Promise<string | null> {
  const devLoginUserId = resolveDevLoginUserId(
    (await cookies()).get(DEV_LOGIN_COOKIE_NAME)?.value,
  );
  if (devLoginUserId) return devLoginUserId;

  return (await headers()).get(SUPABASE_USER_ID_HEADER);
}
