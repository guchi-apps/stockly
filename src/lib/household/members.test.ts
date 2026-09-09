import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertCanManageMembers,
  assertLeaveAllowed,
  assertRemovalAllowed,
  assertRoleChangeAllowed,
  canManageMembers,
  checkInvitationAcceptable,
  countOwners,
  describeLeaveBlock,
  hashInvitationToken,
  HouseholdInputError,
  HouseholdPermissionError,
  invitationExpiresAt,
  invitationState,
  INVITATION_TTL_DAYS,
  newInvitationToken,
  normalizeInviteEmail,
  parseHouseholdName,
  parseHouseholdRole,
  type InvitationSnapshot,
  type MemberRoleSnapshot,
} from "./members.ts";

const OWNER: MemberRoleSnapshot = { userId: "u-owner", role: "OWNER" };
const OWNER2: MemberRoleSnapshot = { userId: "u-owner2", role: "OWNER" };
const MEMBER: MemberRoleSnapshot = { userId: "u-member", role: "MEMBER" };

describe("役割でできることを分ける", () => {
  it("家庭を変える操作はOWNERだけができる", () => {
    assert.equal(canManageMembers("OWNER"), true);
    assert.equal(canManageMembers("MEMBER"), false);
  });

  it("MEMBERが呼ぶと拒否する（画面でボタンを隠すのとは別に、サーバー側で止める）", () => {
    assert.throws(() => assertCanManageMembers("MEMBER"), HouseholdPermissionError);
    assert.doesNotThrow(() => assertCanManageMembers("OWNER"));
  });

  it("知らない役割は既定へ寄せずに落とす", () => {
    assert.equal(parseHouseholdRole("OWNER"), "OWNER");
    assert.equal(parseHouseholdRole(" MEMBER "), "MEMBER");
    assert.throws(() => parseHouseholdRole("ADMIN"), HouseholdInputError);
    assert.throws(() => parseHouseholdRole(""), HouseholdInputError);
    assert.throws(() => parseHouseholdRole(null), HouseholdInputError);
  });
});

describe("最後のオーナーを失わせない", () => {
  it("オーナーが1人しかいないとき、その人をメンバーにできない", () => {
    assert.throws(
      () => assertRoleChangeAllowed([OWNER, MEMBER], OWNER.userId, "MEMBER"),
      HouseholdInputError,
    );
  });

  it("オーナーが2人いれば降格できる", () => {
    assert.doesNotThrow(() => assertRoleChangeAllowed([OWNER, OWNER2], OWNER.userId, "MEMBER"));
  });

  it("同じ役割への変更は何も起きない（オーナーが1人でも通る）", () => {
    assert.doesNotThrow(() => assertRoleChangeAllowed([OWNER, MEMBER], OWNER.userId, "OWNER"));
  });

  it("メンバーでない人は指定できない", () => {
    assert.throws(
      () => assertRoleChangeAllowed([OWNER], "u-stranger", "OWNER"),
      HouseholdInputError,
    );
  });

  it("最後のオーナーは外せないが、オーナーが2人いれば外せる", () => {
    assert.throws(
      () => assertRemovalAllowed([OWNER, MEMBER], OWNER.userId, MEMBER.userId),
      HouseholdInputError,
    );
    assert.doesNotThrow(() =>
      assertRemovalAllowed([OWNER, OWNER2, MEMBER], OWNER.userId, OWNER2.userId),
    );
  });

  it("メンバーは外せる", () => {
    assert.doesNotThrow(() => assertRemovalAllowed([OWNER, MEMBER], MEMBER.userId, OWNER.userId));
  });

  it("自分を外すときは除名ではなく脱退を使わせる", () => {
    assert.throws(
      () => assertRemovalAllowed([OWNER, OWNER2], OWNER.userId, OWNER.userId),
      HouseholdInputError,
    );
  });

  it("最後のオーナーは脱退できない", () => {
    assert.throws(() => assertLeaveAllowed([OWNER, MEMBER], OWNER.userId), HouseholdInputError);
    assert.doesNotThrow(() => assertLeaveAllowed([OWNER, OWNER2], OWNER.userId));
  });

  it("ひとりだけの家庭からは抜けられない（誰も所属しない家庭を残さない）", () => {
    assert.throws(() => assertLeaveAllowed([OWNER], OWNER.userId), HouseholdInputError);
  });

  it("メンバーは自由に抜けられる", () => {
    assert.doesNotThrow(() => assertLeaveAllowed([OWNER, MEMBER], MEMBER.userId));
  });

  it("オーナーの人数を数える", () => {
    assert.equal(countOwners([OWNER, OWNER2, MEMBER]), 2);
    assert.equal(countOwners([MEMBER]), 0);
  });
});

describe("家庭の名前", () => {
  it("前後の空白を落とす", () => {
    assert.equal(parseHouseholdName("  わが家 "), "わが家");
  });

  it("空にはできない", () => {
    assert.throws(() => parseHouseholdName("   "), HouseholdInputError);
  });

  it("長すぎる名前は拒否する", () => {
    assert.throws(() => parseHouseholdName("あ".repeat(61)), HouseholdInputError);
  });
});

describe("招待の宛先", () => {
  it("小文字へ揃える（Googleアカウントの表示は大文字を含みうる）", () => {
    assert.equal(normalizeInviteEmail(" Family@Example.COM "), "family@example.com");
  });

  it("形式が正しくない値は拒否する", () => {
    assert.throws(() => normalizeInviteEmail("family"), HouseholdInputError);
    assert.throws(() => normalizeInviteEmail("family@example"), HouseholdInputError);
    assert.throws(() => normalizeInviteEmail(""), HouseholdInputError);
  });
});

describe("招待のトークン", () => {
  it("毎回違う値を発行する", () => {
    assert.notEqual(newInvitationToken(), newInvitationToken());
  });

  it("URLのパスにそのまま置ける文字だけを使う", () => {
    assert.match(newInvitationToken(), /^[A-Za-z0-9_-]+$/);
  });

  it("保存するのはハッシュで、同じトークンからは同じ値になる", () => {
    const token = newInvitationToken();
    const hash = hashInvitationToken(token);
    assert.equal(hash.length, 64);
    assert.equal(hashInvitationToken(token), hash);
    assert.notEqual(hashInvitationToken(newInvitationToken()), hash);
  });

  it("空のトークンは引き当てに使わせない", () => {
    assert.throws(() => hashInvitationToken(""), HouseholdInputError);
  });

  it("有効期限は発行から7日", () => {
    const now = new Date("2026-09-08T00:00:00.000Z");
    const expires = invitationExpiresAt(now);
    assert.equal(
      (expires.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
      INVITATION_TTL_DAYS,
    );
  });
});

const NOW = new Date("2026-09-08T12:00:00.000Z");

function invitation(overrides: Partial<InvitationSnapshot> = {}): InvitationSnapshot {
  return {
    email: "family@example.com",
    expiresAt: new Date("2026-09-15T12:00:00.000Z"),
    acceptedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

describe("招待の状態", () => {
  it("受け入れも取り消しもされておらず期限内なら保留中", () => {
    assert.equal(invitationState(invitation(), NOW), "PENDING");
  });

  it("受け入れ済みが最優先", () => {
    assert.equal(
      invitationState(invitation({ acceptedAt: NOW, revokedAt: NOW }), NOW),
      "ACCEPTED",
    );
  });

  it("取り消しは期限切れより先に見る（取り消したのに期限切れと出ると効いたか読めない）", () => {
    const expired = invitation({
      revokedAt: new Date("2026-09-01T00:00:00.000Z"),
      expiresAt: new Date("2026-09-02T00:00:00.000Z"),
    });
    assert.equal(invitationState(expired, NOW), "REVOKED");
  });

  it("期限ちょうどは切れている扱い", () => {
    assert.equal(invitationState(invitation({ expiresAt: NOW }), NOW), "EXPIRED");
  });
});

describe("招待を受け入れてよいか", () => {
  it("宛先と同じアカウントなら受け入れられる", () => {
    const result = checkInvitationAcceptable(invitation(), "family@example.com", false, NOW);
    assert.equal(result.ok, true);
  });

  it("大文字で入っているアカウントでも受け入れられる", () => {
    const result = checkInvitationAcceptable(invitation(), "Family@Example.com", false, NOW);
    assert.equal(result.ok, true);
  });

  it("宛先と違うアカウントでは受け入れられない（リンクを知っているだけでは入れない）", () => {
    const result = checkInvitationAcceptable(invitation(), "other@example.com", false, NOW);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "EMAIL_MISMATCH");
  });

  it("メールアドレスを持たないアカウントでは受け入れられない", () => {
    const result = checkInvitationAcceptable(invitation(), null, false, NOW);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "EMAIL_MISMATCH");
  });

  it("取り消し済み・期限切れ・使用済みはそれぞれ別の理由で断る", () => {
    const revoked = checkInvitationAcceptable(
      invitation({ revokedAt: NOW }),
      "family@example.com",
      false,
      NOW,
    );
    assert.equal(revoked.ok === false && revoked.reason, "REVOKED");

    const expired = checkInvitationAcceptable(
      invitation({ expiresAt: new Date("2026-09-01T00:00:00.000Z") }),
      "family@example.com",
      false,
      NOW,
    );
    assert.equal(expired.ok === false && expired.reason, "EXPIRED");

    const accepted = checkInvitationAcceptable(
      invitation({ acceptedAt: NOW }),
      "family@example.com",
      false,
      NOW,
    );
    assert.equal(accepted.ok === false && accepted.reason, "ACCEPTED");
  });

  it("すでにメンバーなら、宛先が合っていても受け入れさせない", () => {
    const result = checkInvitationAcceptable(invitation(), "family@example.com", true, NOW);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "ALREADY_MEMBER");
  });

  it("状態の判定は宛先の判定より先（期限切れのリンクで宛先を当てさせない）", () => {
    const result = checkInvitationAcceptable(
      invitation({ revokedAt: NOW }),
      "other@example.com",
      false,
      NOW,
    );
    assert.equal(result.ok === false && result.reason, "REVOKED");
  });
});

describe("抜けられない理由は1か所で決める", () => {
  it("最後のひとりは、役割にかかわらず抜けられない", () => {
    assert.equal(
      describeLeaveBlock([MEMBER], MEMBER.userId),
      "あなたひとりの家庭からは抜けられません。抜けると在庫を誰も見られなくなります。",
    );
    assert.equal(
      describeLeaveBlock([OWNER], OWNER.userId),
      "あなたひとりの家庭からは抜けられません。抜けると在庫を誰も見られなくなります。",
    );
  });

  it("最後のオーナーは抜けられない", () => {
    assert.match(
      describeLeaveBlock([OWNER, MEMBER], OWNER.userId) ?? "",
      /オーナーがいなくなるため/,
    );
  });

  it("抜けてよいときはnull（画面はボタンを出す）", () => {
    assert.equal(describeLeaveBlock([OWNER, MEMBER], MEMBER.userId), null);
    assert.equal(describeLeaveBlock([OWNER, OWNER2], OWNER.userId), null);
  });
});
