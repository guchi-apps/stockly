import { db } from "@/lib/db";

export type StocklyUserProfile = {
  supabaseUserId: string;
  email: string | null;
  name: string | null;
  imageUrl: string | null;
};

/**
 * ログインした利用者のStockly側の行を用意する。
 *
 * **許可判定（`isAllowedEmail()`）を通した後にだけ呼ぶこと。** ここではもう判定しない。
 * Supabaseは他アプリと共有のプロジェクトなので、この関数を判定前に呼ぶと、Stocklyを
 * 使ってよくないアカウントにも利用者と家庭ができてしまう。
 *
 * 初回ログイン時は家庭を1つ作り、本人をOWNERとして所属させる。家庭が無いと在庫を
 * どこにも置けず、ログインした直後の画面が成立しないため。作成と所属は同じトランザクションに
 * 入れ、家庭だけができて誰も所属していない状態を残さない。
 */
export async function ensureStocklyUser(profile: StocklyUserProfile) {
  const user = await db.user.upsert({
    where: { supabaseUserId: profile.supabaseUserId },
    create: {
      supabaseUserId: profile.supabaseUserId,
      email: profile.email,
      name: profile.name,
      imageUrl: profile.imageUrl,
    },
    update: {
      email: profile.email,
      name: profile.name,
      imageUrl: profile.imageUrl,
    },
  });

  const membershipCount = await db.householdMember.count({ where: { userId: user.id } });
  if (membershipCount > 0) return user;

  await db.$transaction(async (tx) => {
    const household = await tx.household.create({
      data: { name: defaultHouseholdName(profile) },
    });
    await tx.householdMember.create({
      data: { householdId: household.id, userId: user.id, role: "OWNER" },
    });
  });

  return user;
}

/** 初回に作る家庭の名前。あとから変えられる前提の仮の名前で、識別には使わない。 */
function defaultHouseholdName(profile: StocklyUserProfile): string {
  const owner = profile.name?.trim() || profile.email?.split("@")[0]?.trim();
  return owner ? `${owner}の家` : "わが家";
}
