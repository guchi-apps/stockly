/**
 * DB制約テスト（#18）の共通ヘルパー。
 *
 * `src/**\/*.test.ts`（`pnpm test:unit`）とは別に`db-tests/**\/*.test.ts`（`pnpm test:db`）
 * として分けてあるため、`test:unit`はDBに接続しないという前提を崩さない。
 * 実行には実際のMySQL/MariaDBへ接続できる`DATABASE_URL`が要る。
 */
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
