/**
 * 認証idが変わってデータが分かれた（または分かれかけた）利用者を、人が確かめて直すための処理（#134）。
 *
 * ログイン時の自動の付け替え（`account-link.ts`）は、Googleアカウントのidが一致したときだけ行う。
 * それより前から居る利用者（`googleSubject`がまだ埋まっていない）や、メールしか手がかりが無い
 * 場合は自動では寄せず、ここで**読み取りで状況を確かめ、本人だと確認できた1人だけを付け替える**。
 *
 * - `findAccountSplits()`は読み取りだけ。メールが同じUserの組と、それぞれの所属・在庫の件数を返す
 * - `relinkUserManually()`は1人のUserの`supabaseUserId`を付け替える。**家庭の削除・在庫の付け替え・
 *   Userの削除はしない**（分かれた側のUserと家庭は残し、扱いは個別に決める）
 *
 * `scripts/account-links.ts`と`db-tests/`から呼ぶため、Prismaクライアントは引数で受け取る。
 */
import type { AccountLinkClient } from "./account-link.ts";

export type SplitMembership = {
  householdId: string;
  householdName: string;
  role: string;
  removed: boolean;
  stockLotCount: number;
  transactionCount: number;
};

export type SplitUser = {
  userId: string;
  supabaseUserId: string;
  hasGoogleSubject: boolean;
  createdAt: Date;
  memberships: SplitMembership[];
};

export type AccountSplit = {
  /** 画面・ログに出すための伏せ字（先頭1文字とドメインだけ）。 */
  maskedEmail: string;
  users: SplitUser[];
};

/**
 * 同じメールを持つUserが2人以上いる組を返す（読み取りだけ）。
 *
 * メールの比較はDBの照合順序（`utf8mb4_unicode_ci`）に任せるので、大文字・小文字の違いは同じ組になる。
 * 同じメールでも別の本人でありうるため、ここで見つかったことは「分かれた」証拠ではない。
 */
export async function findAccountSplits(prisma: AccountLinkClient): Promise<AccountSplit[]> {
  const groups = await prisma.user.groupBy({
    by: ["email"],
    where: { email: { not: null } },
    _count: { _all: true },
    having: { email: { _count: { gt: 1 } } },
  });

  const splits: AccountSplit[] = [];
  for (const group of groups) {
    if (!group.email) continue;
    const users = await prisma.user.findMany({
      where: { email: group.email },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        supabaseUserId: true,
        googleSubject: true,
        createdAt: true,
        memberships: {
          orderBy: { createdAt: "asc" },
          select: {
            role: true,
            removedAt: true,
            household: {
              select: {
                id: true,
                name: true,
                _count: { select: { stockLots: true, transactions: true } },
              },
            },
          },
        },
      },
    });

    splits.push({
      maskedEmail: maskEmail(group.email),
      users: users.map((user) => ({
        userId: user.id,
        supabaseUserId: user.supabaseUserId,
        hasGoogleSubject: user.googleSubject !== null,
        createdAt: user.createdAt,
        memberships: user.memberships.map((membership) => ({
          householdId: membership.household.id,
          householdName: membership.household.name,
          role: membership.role,
          removed: membership.removedAt !== null,
          stockLotCount: membership.household._count.stockLots,
          transactionCount: membership.household._count.transactions,
        })),
      })),
    });
  }
  return splits;
}

export type ManualRelinkResult =
  | { status: "dry_run" | "relinked"; userId: string; previousSupabaseUserId: string }
  | { status: "user_not_found" }
  | { status: "already_linked" }
  /** 付け替え先のidを、すでに別のUserが持っている。 */
  | { status: "supabase_user_in_use"; holderUserId: string; holderMembershipCount: number };

/**
 * 1人のUserの`supabaseUserId`を、新しい認証idへ付け替える。`apply`が偽なら何も書かない。
 *
 * **本人であることは、この関数を呼ぶ前に人が確かめる**（メールが同じというだけでは呼ばない）。
 * `googleSubject`は消して、付け替えた本人が次にログインしたときに埋め直させる——別のGoogle
 * アカウントへ付け替える判断をした場合に、古い識別子が残って照合を止めないようにするため。
 *
 * 付け替え先のidを別のUserがすでに持っているときは、何もせずに断る。そのUserと家庭の扱い
 * （残す・中身を確かめて消す）は個別に決めることで、この関数では消さない。
 */
export async function relinkUserManually(
  prisma: AccountLinkClient,
  params: { userId: string; supabaseUserId: string; apply: boolean },
): Promise<ManualRelinkResult> {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: params.userId },
      select: { id: true, supabaseUserId: true },
    });
    if (!user) return { status: "user_not_found" };
    if (user.supabaseUserId === params.supabaseUserId) return { status: "already_linked" };

    const holder = await tx.user.findUnique({
      where: { supabaseUserId: params.supabaseUserId },
      select: { id: true, _count: { select: { memberships: true } } },
    });
    if (holder) {
      return {
        status: "supabase_user_in_use",
        holderUserId: holder.id,
        holderMembershipCount: holder._count.memberships,
      };
    }

    if (!params.apply) {
      return { status: "dry_run", userId: user.id, previousSupabaseUserId: user.supabaseUserId };
    }

    await tx.user.update({
      where: { id: user.id },
      data: { supabaseUserId: params.supabaseUserId, googleSubject: null },
    });
    return { status: "relinked", userId: user.id, previousSupabaseUserId: user.supabaseUserId };
  });
}

/** `alice@example.com` → `a***@example.com`。運用の出力にメールをそのまま残さない。 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***${email.slice(at)}`;
}
