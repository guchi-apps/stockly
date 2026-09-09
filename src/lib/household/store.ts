import { db } from "@/lib/db";

import type { HouseholdMembership, HouseholdMembershipStore } from "@/lib/household/access";

/**
 * `HouseholdMembershipStore`のPrisma実装。
 *
 * `access.ts`をPrismaから切り離しているのは、境界の判定そのものをDBの無いCIでも
 * テストできるようにするため（`access.test.ts`）。ここはその差し替え口で、
 * ロジックを持たない。
 *
 * **ただし1つだけ持っている条件がある。`removedAt: null`（#12）。** 除名・脱退では
 * `HouseholdMember`の行を消さず`removedAt`を入れるだけなので（履歴が記録者としてこの行を
 * 参照しているため。`schema.prisma`参照）、ここで絞らないと**外した人が在庫へ戻れてしまう**。
 * 所属を引くクエリはこの2つだけで、新しく増やすときも同じ条件を必ず入れること。
 */
export const householdMembershipStore: HouseholdMembershipStore = {
  async findMembership({ userId, householdId }): Promise<HouseholdMembership | null> {
    // `findUnique`＋一意キーだと`removedAt`を条件に足せないため`findFirst`を使う。
    const membership = await db.householdMember.findFirst({
      where: { householdId, userId, removedAt: null },
      select: { householdId: true, userId: true, role: true },
    });
    return membership;
  },

  async listMemberships({ userId }): Promise<HouseholdMembership[]> {
    return db.householdMember.findMany({
      where: { userId, removedAt: null },
      select: { householdId: true, userId: true, role: true },
      orderBy: { createdAt: "asc" },
    });
  },
};
