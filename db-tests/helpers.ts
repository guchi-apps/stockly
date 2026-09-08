/**
 * DB制約テスト（#18）の共通ヘルパー。
 *
 * `src/**\/*.test.ts`（`pnpm test:unit`）とは別に`db-tests/**\/*.test.ts`（`pnpm test:db`）
 * として分けてあるため、`test:unit`はDBに接続しないという前提を崩さない。
 * 実行には実際のMySQL/MariaDBへ接続できる`DATABASE_URL`が要る。
 */
import assert from "node:assert/strict";

import { config as loadEnv } from "dotenv";
import { Prisma, PrismaClient } from "@prisma/client";

// `node --test`は.env.localを読まない（next dev・prisma CLIと違う）ため、ここで読む。
// CIでは.env.local自体が無く、DATABASE_URLはジョブのenvで渡るため、無くてもエラーにしない。
loadEnv({ path: ".env.local", quiet: true });

export const prisma = new PrismaClient();

/**
 * テストが作った家庭を後始末する。
 *
 * `Household`の削除は`onDelete: Cascade`で配下へ伝わるが、`StockLot → Product`は`Restrict`なので、
 * 在庫と履歴を持つ家庭をそのまま消すとMariaDBがエラー1217（parent rowの削除拒否）で止める。
 * 取消行（`REVERSAL`）が取消対象を`Restrict`で参照している点も同じで、1回のDELETEでは
 * 行の削除順によって親行が先に消えて失敗する。
 * 以前はこの失敗を握り潰していたため、`pnpm test:db`のたびに検証用の家庭が残っていた（#13）。
 * 子から順に消して、失敗は握り潰さずに表へ出す。
 */
export async function deleteHousehold(householdId: string): Promise<void> {
  await prisma.$transaction([
    // 取消行は取消対象を`Restrict`で参照しているため、先に消す（取消の取消は無いので2段で足りる）。
    prisma.inventoryTransaction.deleteMany({
      where: { householdId, reversesTransactionId: { not: null } },
    }),
    prisma.inventoryTransaction.deleteMany({ where: { householdId } }),
    prisma.stockLot.deleteMany({ where: { householdId } }),
    prisma.household.delete({ where: { id: householdId } }),
  ]);
}

/**
 * 書き込みがDB側で拒否され、行が1件も増えていないことを確かめる（#44）。
 *
 * 期待しているのは制約違反（主に複合外部キー）だが、**Prismaがそれを`P2003`のような
 * エラーコードへマップするかどうかはDBの実装で変わる**。CIのMySQL 8はエラー1452を返して
 * `P2003`になるが、MariaDBは同じ違反で1216を返すことがあり、Prismaはそれを
 * `PrismaClientUnknownRequestError`のまま投げる。エラーの種類で判定すると、制約は効いているのに
 * ローカル（MariaDB）でだけテストが落ち、「境界が壊れている」と誤読される。
 *
 * そこでエラーの種類は問わず、次の2点で確かめる。
 *
 * 1. **DBまで往復したうえでのエラーであること。** `PrismaClientValidationError`のような
 *    クライアント側の弾きは、テストのデータ自体が壊れている合図なので通さない
 *    （通すと、制約が消えたあともテストだけ緑になる）
 * 2. **行が実際に増えていないこと。** エラーの種類を見なくなったぶんの裏取りで、
 *    「DBが受け付けなかった」ことをデータの側から確かめる
 */
export async function assertRejectedByDatabase(
  write: () => Promise<unknown>,
  countRows: () => Promise<number>,
): Promise<void> {
  const before = await countRows();

  let rejected = false;
  let error: unknown;
  try {
    await write();
  } catch (caught) {
    rejected = true;
    error = caught;
  }

  assert.ok(rejected, "書き込みが拒否されなかった（DB制約が効いていない）");
  assert.ok(
    error instanceof Prisma.PrismaClientKnownRequestError ||
      error instanceof Prisma.PrismaClientUnknownRequestError,
    `DBが返したエラーではない（テストのデータ自体が不正な可能性がある）: ${String(error)}`,
  );
  assert.equal(
    await countRows(),
    before,
    "エラーになったが行が増えている（DB側で拒否されていない）",
  );
}

export function createHousehold(name: string) {
  return prisma.household.create({ data: { name } });
}

export function createProduct(householdId: string, name: string) {
  return prisma.product.create({ data: { householdId, name, defaultUnit: "PIECE" } });
}

export function createStorageLocation(householdId: string, name: string) {
  return prisma.storageLocation.create({ data: { householdId, name } });
}

export function createStoragePosition(
  householdId: string,
  storageLocationId: string,
  name: string,
) {
  return prisma.storagePosition.create({ data: { householdId, storageLocationId, name } });
}

/**
 * 外部キー違反か。**Prismaのエラーコードだけで判定しない。**
 *
 * MySQLは外部キー違反に1452（ER_NO_REFERENCED_ROW_2）と1216（ER_NO_REFERENCED_ROW）の
 * 2つのコードを持ち、どちらを返すかはサーバーのビルドによって変わる。Prismaは1452だけを
 * `P2003`へ移すため、1216を返すサーバー（Ubuntu同梱のMySQL 8.0.46で確認）では
 * `PrismaClientUnknownRequestError`のまま届き、制約は効いているのにテストだけが落ちる。
 * CIのmysql:8.0イメージは1452を返すので、CIが緑でもローカルで検証できない状態になる。
 */
export function isForeignKeyViolation(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code === "P2003";
  return (
    error instanceof Prisma.PrismaClientUnknownRequestError &&
    /foreign key constraint fails/i.test(error.message)
  );
}

/** 一意制約違反か。こちらはどのサーバーでも1062へ揃うため、コードだけで判定できる。 */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
