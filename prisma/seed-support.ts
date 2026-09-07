/**
 * seedとfixtureが共有する「名前で寄せるupsert」。
 *
 * カテゴリ・保管場所・商品・詳細位置は、家庭の中で**名前が一意**（`@@unique([householdId, name])`）。
 * そのため「固定idでupsertする」だけだと、同じ名前を別のidで持っている家庭に対して
 * 一意制約で落ちる。落ちるのは次のような、ふつうに起きる場面である。
 *
 * - 画面から「食材」カテゴリや「食品棚」を作ったあとに`pnpm db:seed`を流した
 * - `pnpm db:seed`と`pnpm db:seed:fixture`を両方流した（どちらも「食材」を作る）
 *
 * そこで、まず名前で探し、あればその行を更新し、無ければ固定idで作る。
 * 呼び出し側は**返ってきたidを使って**在庫や履歴を作る（固定idをそのまま使わない）。
 */
import type { PrismaClient } from "@prisma/client";

/** 家庭内で名前が一意なモデル。 */
export type NamedModel = "category" | "storageLocation" | "product";

type NamedDelegate = {
  findFirst: (args: unknown) => Promise<{ id: string } | null>;
  update: (args: unknown) => Promise<unknown>;
  create: (args: unknown) => Promise<{ id: string }>;
};

export async function ensureByName(
  prisma: PrismaClient,
  householdId: string,
  model: NamedModel,
  fixedId: string,
  name: string,
  fields: Record<string, unknown>,
): Promise<string> {
  const table = prisma[model] as unknown as NamedDelegate;

  const existing = await table.findFirst({
    where: { householdId, name },
    select: { id: true },
  });
  if (existing) {
    await table.update({ where: { id: existing.id }, data: fields });
    return existing.id;
  }

  const created = await table.create({
    data: { id: fixedId, householdId, ...fields },
    select: { id: true },
  });
  return created.id;
}

/** 詳細位置は「保管場所の中で名前が一意」なので、場所とセットで探す。 */
export async function ensurePositionByName(
  prisma: PrismaClient,
  householdId: string,
  storageLocationId: string,
  fixedId: string,
  name: string,
  fields: Record<string, unknown>,
): Promise<string> {
  const existing = await prisma.storagePosition.findFirst({
    where: { householdId, storageLocationId, name },
    select: { id: true },
  });
  if (existing) {
    await prisma.storagePosition.update({ where: { id: existing.id }, data: fields });
    return existing.id;
  }

  const created = await prisma.storagePosition.create({
    data: { id: fixedId, householdId, storageLocationId, name, ...fields },
    select: { id: true },
  });
  return created.id;
}
