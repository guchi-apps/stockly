import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// 本番デプロイが稼働版のコミットを照合していることを、deploy.ymlの実物から確かめる（#151）。
// 照合はVPSのapp-deploy-gate（guchi-apps/vps#298・#301）が行う。gateは.envのAPP_COMMIT_SHAと
// 127.0.0.1:<PORT>/api/app-versionのshaを突き合わせ、不一致ならdeployを失敗させる。
// deploy.ymlの責務は、APP_COMMIT_SHA・PORTをenvでgateへ送り、そのあとでdeployを呼ぶこと。
// issue-deckは対象コミットのdeploy.ymlがこの形かで稼働確認の可否を決める（判定はissue-deckの
// src/lib/deploy-version-check.tsのgate）ので、ここではその配線を見る。
const workflow = readFileSync(
  new URL("../.github/workflows/deploy.yml", import.meta.url),
  "utf8",
);

const step = (name: string) => {
  const start = workflow.indexOf(`- name: ${name}\n`);
  assert.ok(start >= 0, `${name} のステップが無い`);
  const rest = workflow.slice(start + 1);
  const end = rest.search(/\n {6}- name: /);
  return { start, body: end >= 0 ? rest.slice(0, end) : rest };
};

test("APP_COMMIT_SHAをstepのenvで受け、gateへのenvで送る", () => {
  const send = step("Send environment variables");
  assert.match(send.body, /^\s+APP_COMMIT_SHA: \$\{\{ github\.sha \}\}$/m);
  assert.ok(send.body.includes('"APP_COMMIT_SHA=${APP_COMMIT_SHA}"'), "APP_COMMIT_SHAを送っていない");
  assert.ok(send.body.includes('"PORT=3116"'), "PORTを送っていない（gateの照合先が決まらない）");
  assert.match(send.body, /\|\s*ssh -p "\$\{SSH_PORT\}" "\$\{USERNAME\}@\$\{HOST\}" env\s*$/m);
});

test("upload → env → deploy の順にgateを呼ぶ", () => {
  const upload = step("Upload archive");
  const send = step("Send environment variables");
  const deploy = step("Deploy and restart");
  assert.match(upload.body, /ssh -p "\$\{SSH_PORT\}" "\$\{USERNAME\}@\$\{HOST\}" upload < deploy\.tar\.gz/);
  assert.match(deploy.body, /ssh -p "\$\{SSH_PORT\}" "\$\{USERNAME\}@\$\{HOST\}" deploy\s*$/m);
  assert.ok(upload.start < send.start && send.start < deploy.start, "upload・env・deployの順になっていない");
});

test("SSH先で任意のスクリプトを実行しない（gateの3語だけ）", () => {
  assert.ok(!workflow.includes("appleboy/ssh-action"), "ssh-actionが残っている");
  assert.ok(!workflow.includes("secrets.SERVER_SSH_PRIVATE_KEY"), "organization共通の鍵を使っている");
});

test("運用終了のため、起動できるトリガーはworkflow_callだけ（#158）", () => {
  // push: mainやworkflow_dispatchを戻すと、アーカイブまでの間に本番へ配られる。
  const on = workflow.match(/^on:\n((?: {2}.*\n)+)/m);
  assert.ok(on, "on: が見つからない");
  assert.equal(on[1].trim(), "workflow_call:");
});
