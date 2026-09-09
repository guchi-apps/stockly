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
 * 入れ、家庭だけができて誰も所属していない状態を残さない。初回ログインが同時に走っても
 * 家庭が二重にできないよう、トランザクションの先頭でUser行をロックする。
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

  // 2回目以降のログインではトランザクションを張らずに済ませる（毎回の行ロックを避けるため）。
  //
  // 数えるのは**いま所属している**行だけ（`removedAt: null`。#12）。除名・脱退では行が残るため、
  // ここで外れた行まで数えると、全部の家庭から外れた人が次にログインしても家庭を持てず、
  // 画面から作る手段も無いまま「家庭が未設定」で固まる。
  if ((await db.householdMember.count({ where: { userId: user.id, removedAt: null } })) > 0) {
    return user;
  }

  await db.$transaction(async (tx) => {
    // **同じ利用者の初回ログインが同時に2つ走ると、所属の件数を数えた直後に両方が
    // 「まだ家庭が無い」と判断し、家庭が2つできる。** それを防ぐため、数える前に
    // 自分のUser行をロックして後続を待たせる。件数の確認と作成をこのロックの内側へ入れる。
    await tx.$queryRaw`SELECT id FROM User WHERE id = ${user.id} FOR UPDATE`;

    if ((await tx.householdMember.count({ where: { userId: user.id, removedAt: null } })) > 0) {
      return;
    }

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
