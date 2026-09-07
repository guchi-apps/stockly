import { db } from "@/lib/db";

import type { HouseholdMembership, HouseholdMembershipStore } from "@/lib/household/access";

/**
 * `HouseholdMembershipStore`のPrisma実装。
 *
 * `access.ts`をPrismaから切り離しているのは、境界の判定そのものをDBの無いCIでも
 * テストできるようにするため（`access.test.ts`）。ここはその差し替え口で、
 * ロジックを持たない。
 */
export const householdMembershipStore: HouseholdMembershipStore = {
  async findMembership({ userId, householdId }): Promise<HouseholdMembership | null> {
    const membership = await db.householdMember.findUnique({
      where: { householdId_userId: { householdId, userId } },
      select: { householdId: true, userId: true, role: true },
    });
    return membership;
  },

  async listMemberships({ userId }): Promise<HouseholdMembership[]> {
    return db.householdMember.findMany({
      where: { userId },
      select: { householdId: true, userId: true, role: true },
      orderBy: { createdAt: "asc" },
    });
  },
};
