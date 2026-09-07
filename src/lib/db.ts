import { PrismaClient } from "@prisma/client";

// `next dev`はモジュールを再読み込みするため、都度newするとDB接続が積み上がって
// MySQLのmax_connectionsを使い切る。開発時だけglobalThisに載せて使い回す。
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
