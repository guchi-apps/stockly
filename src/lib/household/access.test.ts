import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canAccessHousehold,
  findHouseholdMembership,
  HouseholdAccessError,
  listAccessibleHouseholdIds,
  requireHouseholdAccess,
  resolveDefaultHouseholdId,
  scopeToHousehold,
  type HouseholdMembership,
  type HouseholdMembershipStore,
} from "./access.ts";

/**
 * 家庭の境界（#2）を、DBなしで検証する。
 *
 * CIにMariaDBが無いため、所属の問い合わせはメモリ上のスタブに差し替える。実DBでの越境不可は
 * ローカルのMariaDBで別途確認する。ここで確かめたいのは「所属していない家庭を指定したときに
 * 読み書きの条件を組み立てられないこと」であり、それは`access.ts`だけで決まる。
 *
 * 実行: `pnpm test:unit`（Node標準の`node --test`。TypeScriptをそのまま実行する）
 */

const HOME = "household-home";
const PARENTS = "household-parents";
const OTHER = "household-other-family";

const ME = "user-me";
const FAMILY = "user-family";
const STRANGER = "user-stranger";

const memberships: HouseholdMembership[] = [
  { householdId: HOME, userId: ME, role: "OWNER" },
  { householdId: PARENTS, userId: ME, role: "MEMBER" },
  { householdId: HOME, userId: FAMILY, role: "MEMBER" },
  { householdId: OTHER, userId: STRANGER, role: "OWNER" },
];

/**
 * `HouseholdMembershipStore`のスタブ。
 *
 * `findMembership`は`(userId, householdId)`の完全一致だけを返す。Prisma側の
 * `@@unique([householdId, userId])`による`findUnique`と同じ振る舞いにしている。
 */
const store: HouseholdMembershipStore = {
  async findMembership({ userId, householdId }) {
    return (
      memberships.find((m) => m.userId === userId && m.householdId === householdId) ?? null
    );
  },
  async listMemberships({ userId }) {
    return memberships.filter((m) => m.userId === userId);
  },
};

describe("所属している家庭", () => {
  it("所属情報を取得でき、役割も返る", async () => {
    const membership = await findHouseholdMembership(store, ME, HOME);
    assert.equal(membership?.householdId, HOME);
    assert.equal(membership?.role, "OWNER");
  });

  it("読み書きの条件に householdId が必ず載る", async () => {
    const where = await scopeToHousehold(store, ME, HOME, { name: "米" });
    assert.deepEqual(where, { name: "米", householdId: HOME });
  });

  it("同じ家庭の別メンバーも到達できる（家庭単位で共有される）", async () => {
    assert.equal(await canAccessHousehold(store, FAMILY, HOME), true);
  });

  it("複数の家庭に所属できる", async () => {
    assert.deepEqual(await listAccessibleHouseholdIds(store, ME), [HOME, PARENTS]);
    assert.equal(await resolveDefaultHouseholdId(store, ME), HOME);
  });
});

describe("他家庭のデータは読み書きできない", () => {
  it("所属していない家庭は canAccessHousehold が false", async () => {
    assert.equal(await canAccessHousehold(store, ME, OTHER), false);
    assert.equal(await canAccessHousehold(store, STRANGER, HOME), false);
  });

  it("所属していない家庭では requireHouseholdAccess が失敗する", async () => {
    await assert.rejects(
      () => requireHouseholdAccess(store, ME, OTHER),
      (error: unknown) => error instanceof HouseholdAccessError,
    );
  });

  it("所属していない家庭では読み書きの条件を組み立てられない（越境クエリが作れない）", async () => {
    await assert.rejects(
      () => scopeToHousehold(store, ME, OTHER, { name: "米" }),
      (error: unknown) => error instanceof HouseholdAccessError,
    );
  });

  it("where に他家庭のidを混ぜても、所属している家庭へ上書きされる", async () => {
    const where = await scopeToHousehold(store, ME, HOME, { householdId: OTHER });
    assert.equal(where.householdId, HOME);
  });

  it("所属していない利用者には家庭が1つも見えない", async () => {
    assert.deepEqual(await listAccessibleHouseholdIds(store, "user-unknown"), []);
    assert.equal(await resolveDefaultHouseholdId(store, "user-unknown"), null);
  });
});

describe("値が欠けているときは拒否する（fail-closed）", () => {
  it("userId が無ければ拒否する", async () => {
    assert.equal(await canAccessHousehold(store, null, HOME), false);
    assert.equal(await canAccessHousehold(store, undefined, HOME), false);
    assert.equal(await canAccessHousehold(store, "", HOME), false);
    assert.equal(await canAccessHousehold(store, "   ", HOME), false);
  });

  it("householdId が無ければ拒否する", async () => {
    assert.equal(await canAccessHousehold(store, ME, null), false);
    assert.equal(await canAccessHousehold(store, ME, ""), false);
  });

  it("値が欠けたまま全件を引く条件にならない", async () => {
    await assert.rejects(
      () => scopeToHousehold(store, ME, ""),
      (error: unknown) => error instanceof HouseholdAccessError,
    );
    assert.deepEqual(await listAccessibleHouseholdIds(store, null), []);
  });

  it("ストアが条件と食い違う行を返しても採用しない", async () => {
    const brokenStore: HouseholdMembershipStore = {
      // 条件を無視して常に他家庭の所属を返す、壊れた（あるいは細工された）ストア。
      async findMembership() {
        return { householdId: OTHER, userId: STRANGER, role: "OWNER" };
      },
      async listMemberships() {
        return [{ householdId: OTHER, userId: STRANGER, role: "OWNER" }];
      },
    };

    assert.equal(await canAccessHousehold(brokenStore, ME, HOME), false);
    assert.deepEqual(await listAccessibleHouseholdIds(brokenStore, ME), []);
  });
});
