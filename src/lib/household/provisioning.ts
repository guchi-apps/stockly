import { linkStocklyUser, type LinkResult, type StocklyUserProfile } from "@/lib/auth/account-link";
import { db } from "@/lib/db";

export type { StocklyUserProfile };

/**
 * ログインした利用者のStockly側の行を用意する。
 *
 * **許可判定（`isAllowedEmail()`）を通した後にだけ呼ぶこと。** ここではもう判定しない。
 * Supabaseは他アプリと共有のプロジェクトなので、この関数を判定前に呼ぶと、Stocklyを
 * 使ってよくないアカウントにも利用者と家庭ができてしまう。
 *
 * 本人の照合（認証idが変わった同じ本人を新しい利用者として扱わない。#134）と、初回の家庭の
 * 作成は`src/lib/auth/account-link.ts`が行う。`recovery_required`のときは何も作られていない。
 */
export async function ensureStocklyUser(profile: StocklyUserProfile): Promise<LinkResult> {
  return linkStocklyUser(db, profile);
}
