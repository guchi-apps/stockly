import { cookies } from "next/headers";

/**
 * 「いまどの家庭を見ているか」をCookieで持ち越す（#12）。
 *
 * 複数の家庭に所属していると、既定（いちばん古い所属）だけでは招待された家庭へ行けない。
 * **招待を受け入れた直後にその家庭を見せる**のと、`/household`から切り替えるのに使う。
 *
 * **値は所属の担保ではない。** 書き換えられる前提で、読むときに
 * `resolveActiveHouseholdId()`が所属しているidかを確かめ、さらに在庫のクエリは
 * `scopeToHousehold()`でもう一度確かめる。Cookieを差し替えても他家庭は開かない。
 */
export const ACTIVE_HOUSEHOLD_COOKIE = "stockly-household";

/** 1年。切り替えは滅多に起きないので、短くしても不便になるだけ。 */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export async function readActiveHouseholdCookie(): Promise<string | null> {
  return (await cookies()).get(ACTIVE_HOUSEHOLD_COOKIE)?.value ?? null;
}

/** Server ActionとRoute Handlerからだけ呼べる（画面の描画中はCookieを書けない）。 */
export async function setActiveHouseholdCookie(householdId: string): Promise<void> {
  (await cookies()).set(ACTIVE_HOUSEHOLD_COOKIE, householdId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

/** 家庭から抜けたときに消す。残しておくと、次のリクエストで既定へ落ちるまで無駄に1往復する。 */
export async function clearActiveHouseholdCookie(): Promise<void> {
  (await cookies()).delete(ACTIVE_HOUSEHOLD_COOKIE);
}
