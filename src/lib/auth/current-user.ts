import { cookies, headers } from "next/headers";

import { SUPABASE_USER_ID_HEADER } from "@/lib/auth/auth-header";
import { DEV_LOGIN_COOKIE_NAME, resolveDevLoginUserId } from "@/lib/auth/dev-login";
import { db } from "@/lib/db";
import { readActiveHouseholdCookie } from "@/lib/household/active-household";
import {
  listAccessibleHouseholdIds,
  resolveActiveHouseholdId,
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
 * ログイン中の利用者と、いま見せる家庭をまとめて返す。
 *
 * 在庫を扱う画面・APIはここで得た`householdId`を`scopeToHousehold()`へ渡す。
 *
 * **どの家庭を見せるかはCookieで持ち越す**（#12）。複数の家庭に所属しうるため、いちばん古い
 * 所属に固定すると、招待されて参加しても自分の家庭が出たままになる。Cookieの値は
 * `resolveActiveHouseholdId()`が所属しているidかを確かめてから使う。
 */
export async function getCurrentSession() {
  const user = await getCurrentUser();
  if (!user) return null;

  const householdIds = await listAccessibleHouseholdIds(householdMembershipStore, user.id);
  const requested = await readActiveHouseholdCookie();

  return {
    user,
    householdIds,
    householdId: resolveActiveHouseholdId(householdIds, requested),
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
