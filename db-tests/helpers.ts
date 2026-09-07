/**
 * DB制約テスト（#18）の共通ヘルパー。
 *
 * `src/**\/*.test.ts`（`pnpm test:unit`）とは別に`db-tests/**\/*.test.ts`（`pnpm test:db`）
 * として分けてあるため、`test:unit`はDBに接続しないという前提を崩さない。
 * 実行には実際のMySQL/MariaDBへ接続できる`DATABASE_URL`が要る。
 */
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

// `node --test`は.env.localを読まない（next dev・prisma CLIと違う）ため、ここで読む。
// CIでは.env.local自体が無く、DATABASE_URLはジョブのenvで渡るため、無くてもエラーにしない。
loadEnv({ path: ".env.local", quiet: true });

export const prisma = new PrismaClient();

/** テストが作った家庭を後始末する。onDelete: Cascadeで配下の行もまとめて消える。 */
export async function deleteHousehold(householdId: string): Promise<void> {
  await prisma.household.delete({ where: { id: householdId } }).catch(() => {});
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
