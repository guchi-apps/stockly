import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decideAccountLink,
  isRetryableConflict,
  linkStocklyUser,
  resolveGoogleSubject,
  type AccountLinkClient,
  type LinkCandidates,
} from "./account-link.ts";
import { maskEmail } from "./account-recovery.ts";

/**
 * 認証idが変わった同じ本人を、新しい利用者として扱わないための照合（#134）。
 * 実DBでの付け替え・家庭の扱いは db-tests/account-link.test.ts が見る。
 */

const none: LinkCandidates = { byAuth: null, bySubject: null, sameEmailUserCount: 0 };

describe("resolveGoogleSubject: 照合に使うGoogleのidはidentitiesからだけ取る", () => {
  it("Googleのidentityが1つなら、そのidを返す", () => {
    assert.equal(
      resolveGoogleSubject([{ provider: "google", id: "g-1", identity_data: { sub: "g-1" } }]),
      "g-1",
    );
  });

  it("idが無くてもidentity_data.subがあれば使う", () => {
    assert.equal(resolveGoogleSubject([{ provider: "google", identity_data: { sub: "g-1" } }]), "g-1");
  });

  it("idとsubが食い違うなら信用しない", () => {
    assert.equal(
      resolveGoogleSubject([{ provider: "google", id: "g-1", identity_data: { sub: "g-2" } }]),
      null,
    );
  });

  it("Google以外のidentityしか無い・identitiesが無いならnull", () => {
    assert.equal(resolveGoogleSubject([{ provider: "github", id: "42" }]), null);
    assert.equal(resolveGoogleSubject(undefined), null);
    assert.equal(resolveGoogleSubject([]), null);
  });

  it("Googleのidentityが複数あると1つに決められないのでnull", () => {
    assert.equal(
      resolveGoogleSubject([
        { provider: "google", id: "g-1" },
        { provider: "google", id: "g-2" },
      ]),
      null,
    );
  });
});

describe("decideAccountLink: 本人の照合", () => {
  it("同じsupabaseUserIdなら既存のUserで、Googleのidが未記録なら書き足す", () => {
    assert.deepEqual(
      decideAccountLink(
        { googleSubject: "g-1" },
        { ...none, byAuth: { id: "u-1", googleSubject: null } },
      ),
      { kind: "existing", userId: "u-1", recordSubject: true },
    );
  });

  it("Googleのidが取れないときも既存のUserでログインできる（書き足さない）", () => {
    assert.deepEqual(
      decideAccountLink({ googleSubject: null }, { ...none, byAuth: { id: "u-1", googleSubject: "g-1" } }),
      { kind: "existing", userId: "u-1", recordSubject: false },
    );
  });

  it("認証idが変わってもGoogleのidが一致すれば、そのUserへ付け替える（新設しない）", () => {
    assert.deepEqual(
      decideAccountLink(
        { googleSubject: "g-1" },
        { ...none, bySubject: { id: "u-old", supabaseUserId: "auth-old" } },
      ),
      { kind: "relink", userId: "u-old", previousSupabaseUserId: "auth-old" },
    );
  });

  it("照合できず同じメールのUserが居るなら、作らずに復旧へ回す", () => {
    assert.deepEqual(
      decideAccountLink({ googleSubject: "g-new" }, { ...none, sameEmailUserCount: 1 }),
      { kind: "recovery_required", reason: "same_email" },
    );
  });

  it("Googleのidが取れず同じメールのUserが居るときも、メールだけでは寄せない", () => {
    assert.deepEqual(
      decideAccountLink({ googleSubject: null }, { ...none, sameEmailUserCount: 2 }),
      { kind: "recovery_required", reason: "same_email" },
    );
  });

  it("どれにも当たらない正規の新規利用者は作る", () => {
    assert.deepEqual(decideAccountLink({ googleSubject: "g-1" }, none), { kind: "create" });
  });

  it("同じsupabaseUserIdなのに覚えているGoogleのidと違うなら、上書きせず復旧へ回す", () => {
    assert.deepEqual(
      decideAccountLink(
        { googleSubject: "g-other" },
        { ...none, byAuth: { id: "u-1", googleSubject: "g-1" } },
      ),
      { kind: "recovery_required", reason: "subject_mismatch" },
    );
  });

  it("Googleのidを別のUserがすでに持っていたら、既存のUserでログインさせ識別子は書かない", () => {
    assert.deepEqual(
      decideAccountLink(
        { googleSubject: "g-1" },
        {
          ...none,
          byAuth: { id: "u-new", googleSubject: null },
          bySubject: { id: "u-old", supabaseUserId: "auth-old" },
        },
      ),
      { kind: "existing", userId: "u-new", recordSubject: false },
    );
  });
});

describe("linkStocklyUser: 同時ログインの競合はトランザクションごとやり直す", () => {
  function fakeClient(failures: unknown[]) {
    let calls = 0;
    const client = {
      async $transaction() {
        calls += 1;
        const failure = failures.shift();
        if (failure) throw failure;
        return { status: "ready", userId: "u-1", outcome: "existing", createdHousehold: false };
      },
    };
    return { client: client as unknown as AccountLinkClient, calls: () => calls };
  }

  const profile = {
    supabaseUserId: "auth-1",
    googleSubject: "g-1",
    email: null,
    name: null,
    imageUrl: null,
  };

  it("一意制約（P2002）で1回落ちても、やり直して通る", async () => {
    const { client, calls } = fakeClient([{ code: "P2002" }]);
    const result = await linkStocklyUser(client, profile);
    assert.equal(result.status, "ready");
    assert.equal(calls(), 2);
  });

  it("やり直しは3回まで。続けば例外のまま返す（途中の状態は残らない）", async () => {
    const { client, calls } = fakeClient([{ code: "P2034" }, { code: "P2034" }, { code: "P2034" }]);
    await assert.rejects(linkStocklyUser(client, profile));
    assert.equal(calls(), 3);
  });

  it("競合でないエラーはやり直さない", async () => {
    const { client, calls } = fakeClient([new Error("connection refused")]);
    await assert.rejects(linkStocklyUser(client, profile));
    assert.equal(calls(), 1);
  });
});

describe("isRetryableConflict", () => {
  it("P2002・P2034だけをやり直しの対象にする", () => {
    assert.equal(isRetryableConflict({ code: "P2002" }), true);
    assert.equal(isRetryableConflict({ code: "P2034" }), true);
    assert.equal(isRetryableConflict({ code: "P2003" }), false);
    assert.equal(isRetryableConflict(null), false);
  });
});

describe("maskEmail: 運用の出力にメールをそのまま出さない", () => {
  it("先頭1文字とドメインだけを残す", () => {
    assert.equal(maskEmail("alice@example.com"), "a***@example.com");
    assert.equal(maskEmail("broken"), "***");
  });
});
