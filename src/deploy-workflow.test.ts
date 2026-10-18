import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// 本番デプロイが稼働版のコミットを照合していることを、deploy.ymlの実物から確かめる（#151）。
// issue-deckは対象コミットのdeploy.ymlに`APP_COMMIT_SHA`と`/api/app-version`が含まれるかで
// 「照合付き」と判定するが、ここではそれが実際に配線されている（envsで渡り、.envへ書かれ、
// PM2の起動より前で、ヘルスチェックがsha一致まで成功にしない）ことまで見る。
const workflow = readFileSync(
  new URL("../.github/workflows/deploy.yml", import.meta.url),
  "utf8",
);

test("APP_COMMIT_SHAがSSH先まで渡る（env:とenvs:の両方）", () => {
  assert.match(workflow, /^\s+APP_COMMIT_SHA: \$\{\{ github\.sha \}\}$/m);
  const envs = workflow.match(/^\s+envs: (.+)$/m)?.[1];
  assert.ok(envs, "envs: が見つからない");
  assert.ok(envs.split(",").includes("APP_COMMIT_SHA"), envs);
});

test("APP_COMMIT_SHAはPM2の起動より前に.envへ書かれる", () => {
  const write = workflow.indexOf('update_env APP_COMMIT_SHA "$APP_COMMIT_SHA"');
  const start = workflow.indexOf("pm2 start deploy/ecosystem.config.js");
  assert.ok(write >= 0, ".envへの書き込みが無い");
  assert.ok(start >= 0, "pm2 start が無い");
  assert.ok(write < start, ".envへ書く前にPM2を起動している");
});

test("ヘルスチェックは/api/app-versionのshaが一致するまで成功にしない", () => {
  const healthCheck = workflow.slice(workflow.indexOf('echo "Health check..."'));
  assert.match(healthCheck, /curl [^\n]*"http:\/\/127\.0\.0\.1:\$\{PORT\}\/api\/app-version"/);
  assert.ok(healthCheck.includes('grep -qF "\\"sha\\":\\"${APP_COMMIT_SHA}\\""'), "shaの照合が無い");
  // 時間切れは失敗として終える。
  assert.match(healthCheck, /done\n[\s\S]*?exit 1/);
});
