/**
 * 家庭（Household）単位のデータ境界。
 *
 * Stocklyの在庫は家庭に属し、**所属していない家庭のデータには一切到達できない**。その判定を
 * ここ1か所に閉じ、在庫を読み書きするコードは必ずこのモジュールの関数を通す。画面やAPIごとに
 * `where: { householdId }` を手で書くと、書き忘れた1か所がそのまま越境になるため。
 *
 * このファイルはPrismaにもNext.jsにも依存しない。所属の問い合わせは`HouseholdMembershipStore`
 * として外から渡す。
 *
 * - 本番の実体は`src/lib/household/store.ts`（Prisma版）
 * - テスト（`access.test.ts`）はメモリ上のスタブを渡すので、MariaDBの無いCIでも越境不可を検証できる
 */

export type HouseholdRoleName = "OWNER" | "MEMBER";

export type HouseholdMembership = {
  householdId: string;
  userId: string;
  role: HouseholdRoleName;
};

/** 所属の問い合わせだけを持つ最小のインターフェース。 */
export type HouseholdMembershipStore = {
  findMembership(params: {
    userId: string;
    householdId: string;
  }): Promise<HouseholdMembership | null>;
  listMemberships(params: { userId: string }): Promise<HouseholdMembership[]>;
};

/**
 * 所属していない家庭へ触れようとしたときに投げる。
 *
 * 「見つからない」ではなく明示的な失敗にするのは、呼び出し側が握り潰しても
 * 空データとして先に進んでしまわないようにするため。
 */
export class HouseholdAccessError extends Error {
  readonly userId: string;
  readonly householdId: string;

  constructor(userId: string, householdId: string) {
    super(`この家庭のデータへはアクセスできません（userId=${userId} householdId=${householdId}）`);
    this.name = "HouseholdAccessError";
    this.userId = userId;
    this.householdId = householdId;
  }
}

/**
 * 空文字・空白だけのidを弾く。
 *
 * 未ログインや値の取り違えで空文字が流れてきたとき、そのまま問い合わせると
 * ストアの実装次第で「条件なし＝全件」になりうる。判定の入口で落とす（fail-closed）。
 */
function isUsableId(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** 所属していれば所属情報を、していなければnullを返す。 */
export async function findHouseholdMembership(
  store: HouseholdMembershipStore,
  userId: string | null | undefined,
  householdId: string | null | undefined,
): Promise<HouseholdMembership | null> {
  if (!isUsableId(userId) || !isUsableId(householdId)) return null;

  const membership = await store.findMembership({ userId, householdId });
  if (!membership) return null;

  // ストアが条件を取り違えて別人・別家庭の行を返した場合に備え、返ってきた値も突き合わせる。
  if (membership.userId !== userId || membership.householdId !== householdId) return null;

  return membership;
}

/** その家庭のデータへ触れてよいか。 */
export async function canAccessHousehold(
  store: HouseholdMembershipStore,
  userId: string | null | undefined,
  householdId: string | null | undefined,
): Promise<boolean> {
  return (await findHouseholdMembership(store, userId, householdId)) !== null;
}

/** 触れてよければ所属情報を返し、そうでなければ`HouseholdAccessError`を投げる。 */
export async function requireHouseholdAccess(
  store: HouseholdMembershipStore,
  userId: string | null | undefined,
  householdId: string | null | undefined,
): Promise<HouseholdMembership> {
  const membership = await findHouseholdMembership(store, userId, householdId);
  if (!membership) {
    throw new HouseholdAccessError(userId ?? "", householdId ?? "");
  }
  return membership;
}

/**
 * 在庫データを引く・書くときのwhere条件・データを、家庭で絞った形にして返す。
 *
 * **在庫を扱うクエリはこの関数の戻り値をwhere/dataに使う。** 所属を確かめてから
 * `householdId`を必ず載せるので、「所属チェックはしたがwhereに家庭を入れ忘れた」
 * 「whereには入れたが所属を確かめていない」のどちらも起こらない。
 *
 * 呼び出し側が渡した`householdId`は最後に上書きするため、条件の書き換えで
 * 他家庭を指すこともできない。
 */
export async function scopeToHousehold<T extends Record<string, unknown>>(
  store: HouseholdMembershipStore,
  userId: string | null | undefined,
  householdId: string | null | undefined,
  where: T = {} as T,
): Promise<T & { householdId: string }> {
  const membership = await requireHouseholdAccess(store, userId, householdId);
  return { ...where, householdId: membership.householdId };
}

/** その利用者が所属している家庭のid一覧。 */
export async function listAccessibleHouseholdIds(
  store: HouseholdMembershipStore,
  userId: string | null | undefined,
): Promise<string[]> {
  if (!isUsableId(userId)) return [];

  const memberships = await store.listMemberships({ userId });
  return memberships.filter((m) => m.userId === userId).map((m) => m.householdId);
}

/**
 * 画面を開いたときに既定で見せる家庭。
 *
 * 複数所属は将来の共有Issueで扱う。いまは所属のうち先頭（ストアが古い順に返す）を使う。
 */
export async function resolveDefaultHouseholdId(
  store: HouseholdMembershipStore,
  userId: string | null | undefined,
): Promise<string | null> {
  const householdIds = await listAccessibleHouseholdIds(store, userId);
  return householdIds[0] ?? null;
}
