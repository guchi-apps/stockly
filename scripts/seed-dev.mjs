// 開発用ログイン（`POST /api/dev/login`）で入るダミーデータを投入し、
// バイパス用シークレットを .env.local へ用意する。
//
//   pnpm db:seed:dev
//   pnpm dev            # next dev は起動時に .env.local を読むので、生成後は起こし直す
//
// 入れるのは実利用者とは無関係のダミーで、家庭を2つ作る。1つは開発用ユーザーが所属する家庭、
// もう1つは所属していない「他人の家庭」で、越境できないことを実際に確かめるために置く。
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = path.join(ROOT, ".env.local");

// これらは src/lib/auth/dev-login.ts の定数と対になっている。片方だけ変えないこと。
const DEV_LOGIN_SUPABASE_USER_ID = "dev-login-bot";
const SECRET_KEY = "CI_LOGIN_BYPASS_SECRET";

if (!existsSync(ENV_FILE)) {
  console.error(`Error: ${ENV_FILE} がありません。先に pnpm env:init を実行してください。`);
  process.exit(1);
}

ensureBypassSecret();
loadEnv({ path: ENV_FILE, quiet: true });

const databaseUrl = process.env.DATABASE_URL ?? "";
// 本番DBへ流さない最後の砦。接続先がローカルであることを確かめてから書き込む。
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl)) {
  console.error("Error: DATABASE_URL の接続先がローカルではありません。開発用シードは中止します。");
  process.exit(1);
}

const db = new PrismaClient();

try {
  const user = await db.user.upsert({
    where: { supabaseUserId: DEV_LOGIN_SUPABASE_USER_ID },
    create: {
      supabaseUserId: DEV_LOGIN_SUPABASE_USER_ID,
      email: "dev-login-bot@example.invalid",
      name: "開発用ユーザー",
    },
    update: { name: "開発用ユーザー" },
  });

  const ownHousehold = await upsertHousehold("dev-household-own", "開発用の家");
  await db.householdMember.upsert({
    where: { householdId_userId: { householdId: ownHousehold.id, userId: user.id } },
    create: { householdId: ownHousehold.id, userId: user.id, role: "OWNER" },
    update: { role: "OWNER" },
  });

  // 開発用ユーザーが所属しない家庭。境界の確認用で、誰も所属させない。
  const otherHousehold = await upsertHousehold("dev-household-other", "他人の家（所属していない）");

  console.log("開発用のダミーデータを投入しました。");
  console.log(`  user            : ${user.name} (${user.id})`);
  console.log(`  所属する家庭    : ${ownHousehold.name} (${ownHousehold.id})`);
  console.log(`  所属しない家庭  : ${otherHousehold.name} (${otherHousehold.id})`);
  console.log("");
  console.log("次: pnpm dev で起こし直し、POST /api/dev/login でログインできます。");
} finally {
  await db.$disconnect();
}

/** idを固定してupsertする。何度流しても家庭が増えないようにするため。 */
async function upsertHousehold(id, name) {
  return db.household.upsert({ where: { id }, create: { id, name }, update: { name } });
}

/**
 * .env.local に CI_LOGIN_BYPASS_SECRET が無ければ生成して追記する。
 *
 * 値は .env.local（git管理外）にだけ置き、コミットしない。worktreeを作り直すと
 * .env.local ごと無くなるため、その都度ここで作り直す前提にしている。
 */
function ensureBypassSecret() {
  const contents = readFileSync(ENV_FILE, "utf8");
  const existing = contents.match(new RegExp(`^${SECRET_KEY}=(.*)$`, "m"));

  if (existing && existing[1].replace(/^["']|["']$/g, "").length > 0) {
    console.log(`${SECRET_KEY}: 既存の値を使います。`);
    return;
  }

  const secret = randomBytes(32).toString("hex");
  const line = `\n# 開発用ログイン（POST /api/dev/login）のシークレット。pnpm db:seed:dev が生成する。\n# 本番では設定しない（設定してもNODE_ENV=productionで無効）。\n${SECRET_KEY}="${secret}"\n`;

  writeFileSync(
    ENV_FILE,
    existing ? contents.replace(existing[0], `${SECRET_KEY}="${secret}"`) : contents + line,
  );
  console.log(`${SECRET_KEY}: .env.local へ生成しました。`);
}
