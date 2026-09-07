// Prisma CLI（migrate/generate/studio）はNext.jsと違い `.env.local` を自動で読まず、
// `.env` しか読まない。`prisma migrate dev` 等が `next dev` と同じDATABASE_URLを
// 見るように、ここで明示的に読み込む。
import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// `quiet: true` を付けるのは、dotenv v17が読み込み結果の案内文を **stdout** へ出すため。
// `prisma migrate dev` / `migrate diff --script` が生成するSQLは同じstdoutへ流れるので、
// 案内文がmigration.sqlの1行目へ混ざり、本番の `migrate deploy` が構文エラーで落ちる。
loadEnv({ path: ".env.local", quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
});
