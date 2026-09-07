import { PrismaClient } from "@prisma/client";

// 開発中はモジュールが再読み込みされるたびにPrismaClientが増え、DBの接続数を食い潰す。
// globalThisへ退避して1つだけを使い回す。
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
