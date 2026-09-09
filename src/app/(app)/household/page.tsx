import { notFound } from "next/navigation";
import { LogOut, Mail, Users } from "lucide-react";

import {
  changeMemberRoleAction,
  leaveHouseholdAction,
  removeMemberAction,
  renameHouseholdAction,
  revokeInvitationAction,
  switchHouseholdAction,
} from "@/app/(app)/household/actions";
import { ActionNotice, PageHeader, firstValue } from "@/components/inventory/chrome";
import { SubmitButton } from "@/components/inventory/submit-button";
import { InviteMemberForm } from "@/components/household/invite-member-form";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  canManageMembers,
  describeLeaveBlock,
  HOUSEHOLD_ROLE_LABELS,
  HOUSEHOLD_ROLE_NOTES,
} from "@/lib/household/members";
import { listMyHouseholds, loadHouseholdOverview } from "@/lib/household/queries";
import { requireInventoryContext } from "@/lib/inventory/context";

/**
 * 家庭とメンバー（#12）。
 *
 * **オーナーだけが招待・除名・役割の変更・家庭名の変更を行える。** ここではその操作の
 * ボタンを出し分けるだけで、拒否そのものは`src/lib/household/service.ts`が行う
 * （フォームは誰でも直接送れるため、画面での出し分けは担保にならない）。
 *
 * スマホでは、招待フォームがメンバー一覧の下にあって親指が届きにくい。下タブのすぐ上に
 * フォームへ飛ぶ帯を置き、片手のまま発行へ入れるようにしてある。
 */
export default async function HouseholdPage({ searchParams }: PageProps<"/household">) {
  const query = await searchParams;
  const { ctx } = await requireInventoryContext();
  if (!ctx) notFound();

  const [overview, myHouseholds] = await Promise.all([
    loadHouseholdOverview(ctx),
    listMyHouseholds(ctx.userId),
  ]);
  const isOwner = canManageMembers(overview.viewerRole);
  // 抜けられない理由は`members.ts`の1か所で決める。画面とサーバーで判定が分かれると、
  // ボタンは出るのに押すと断られる、という食い違いになる。
  const leaveBlockedReason = describeLeaveBlock(overview.members, ctx.userId);

  return (
    <>
      <PageHeader
        title="家庭とメンバー"
        description={`${overview.householdName} · ${overview.members.length}人`}
        actions={
          <Badge variant={isOwner ? "default" : "outline"}>
            あなたは{HOUSEHOLD_ROLE_LABELS[overview.viewerRole]}
          </Badge>
        }
      />
      <ActionNotice notice={firstValue(query.notice)} error={firstValue(query.error)} />

      {myHouseholds.length > 1 ? (
        // 複数の家庭に所属している場合だけ出す。既定は「いちばん古い所属」なので、
        // これが無いと招待された家庭と自分の家庭を行き来できない（#12の計画レビューでの指摘）。
        <section className="flex flex-col gap-3 border-b px-4 py-4 md:px-6">
          <h2 className="text-muted-foreground text-xs font-semibold">
            見る家庭（{myHouseholds.length}件に所属）
          </h2>
          <ul className="flex flex-wrap gap-2">
            {myHouseholds.map((candidate) => (
              <li key={candidate.id}>
                {candidate.id === overview.householdId ? (
                  <Badge variant="default" className="h-10 px-3 text-sm">
                    {candidate.name}（表示中）
                  </Badge>
                ) : (
                  <form action={switchHouseholdAction}>
                    <input type="hidden" name="householdId" value={candidate.id} />
                    <SubmitButton className="h-10" pendingLabel="切り替え中…">
                      {candidate.name}に切り替える
                    </SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-3 px-4 py-4 md:px-6">
        <h2 className="text-muted-foreground text-xs font-semibold">家庭の名前</h2>
        {isOwner ? (
          <form action={renameHouseholdAction} className="flex flex-wrap items-center gap-2">
            <Input
              name="name"
              defaultValue={overview.householdName}
              aria-label="家庭の名前"
              className="h-11 max-w-64 text-base font-semibold"
            />
            <SubmitButton className="h-11" pendingLabel="保存中…">
              名前を保存
            </SubmitButton>
          </form>
        ) : (
          <p className="text-base font-semibold">{overview.householdName}</p>
        )}
      </section>

      <section className="flex flex-col gap-3 border-t px-4 py-4 md:px-6">
        <h2 className="text-muted-foreground text-xs font-semibold">
          メンバー（{overview.members.length}人）
        </h2>

        <ul className="divide-y rounded-xl border">
          {overview.members.map((member) => (
            <li key={member.userId} className="flex flex-wrap items-center gap-2 px-3 py-3">
              <span className="bg-muted text-muted-foreground grid size-9 shrink-0 place-items-center rounded-lg text-xs font-semibold">
                {member.name.slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{member.name}</span>
                <span className="text-muted-foreground block truncate text-xs">
                  {member.email ?? "メールアドレス未設定"} ·{" "}
                  {member.joinedAt.toLocaleDateString("ja-JP")} から
                </span>
              </span>

              <Badge variant={member.role === "OWNER" ? "default" : "outline"}>
                {HOUSEHOLD_ROLE_LABELS[member.role]}
              </Badge>
              {member.isViewer ? <Badge variant="secondary">自分</Badge> : null}

              {isOwner && !member.isViewer ? (
                <span className="flex w-full flex-wrap gap-2 md:w-auto">
                  <form action={changeMemberRoleAction} className="flex-1 md:flex-none">
                    <input type="hidden" name="targetUserId" value={member.userId} />
                    <input
                      type="hidden"
                      name="role"
                      value={member.role === "OWNER" ? "MEMBER" : "OWNER"}
                    />
                    <SubmitButton className="h-10 w-full" pendingLabel="変更中…">
                      {member.role === "OWNER" ? "メンバーにする" : "オーナーにする"}
                    </SubmitButton>
                  </form>
                  <form action={removeMemberAction} className="flex-1 md:flex-none">
                    <input type="hidden" name="targetUserId" value={member.userId} />
                    <SubmitButton
                      className="text-destructive border-destructive/40 h-10 w-full"
                      pendingLabel="処理中…"
                    >
                      家庭から外す
                    </SubmitButton>
                  </form>
                </span>
              ) : null}
            </li>
          ))}
        </ul>

        <p className="text-muted-foreground text-xs">
          {HOUSEHOLD_ROLE_LABELS.OWNER}は{HOUSEHOLD_ROLE_NOTES.OWNER}。
          {HOUSEHOLD_ROLE_LABELS.MEMBER}は{HOUSEHOLD_ROLE_NOTES.MEMBER}。
          外した人はその時点でこの家庭の在庫・履歴を見られなくなります（記録した履歴は残ります）。
          <b>オーナーが自分ひとりのあいだは、降格も脱退もできません。</b>
        </p>
      </section>

      {isOwner ? (
        <section className="flex flex-col gap-3 border-t px-4 py-4 md:px-6">
          <h2 className="text-muted-foreground text-xs font-semibold">
            保留中の招待（{overview.invitations.length}件）
          </h2>

          {overview.invitations.length === 0 ? (
            <p className="text-muted-foreground flex items-center gap-2 text-xs">
              <Mail className="size-4" aria-hidden />
              有効な招待リンクはありません。
            </p>
          ) : (
            <ul className="divide-y rounded-xl border">
              {overview.invitations.map((invitation) => (
                <li key={invitation.id} className="flex flex-wrap items-center gap-2 px-3 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{invitation.email}</span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {HOUSEHOLD_ROLE_LABELS[invitation.role]} ·{" "}
                      {invitation.expiresAt.toLocaleDateString("ja-JP")} まで有効
                      {invitation.invitedByName ? ` · ${invitation.invitedByName} が発行` : ""}
                    </span>
                  </span>
                  <Badge variant="outline">未参加</Badge>
                  <form action={revokeInvitationAction}>
                    <input type="hidden" name="invitationId" value={invitation.id} />
                    <SubmitButton
                      className="text-destructive border-destructive/40 h-10"
                      pendingLabel="処理中…"
                    >
                      取り消す
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <p className="text-muted-foreground text-xs">
            発行したリンクは一覧に出せません（保存していないため）。渡し損ねたときは取り消して、
            もう一度発行してください。
          </p>
        </section>
      ) : null}

      {isOwner ? <InviteMemberForm /> : null}

      <section className="flex flex-col gap-3 border-t px-4 py-5 md:px-6">
        <h2 className="text-muted-foreground text-xs font-semibold">この家庭から抜ける</h2>
        <p className="text-muted-foreground text-xs">
          抜けると「{overview.householdName}」の在庫・期限・履歴・防災の集計は見られなくなります。
          在庫そのものは家庭に残り、あなたが記録した履歴も残ります。
        </p>

        {leaveBlockedReason ? (
          <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-2 text-xs">
            {leaveBlockedReason}
          </p>
        ) : (
          // 押し間違いで抜けないよう、開いてから押す形にする（確認ダイアログの代わり）。
          <details className="text-sm">
            <summary className="text-destructive w-fit cursor-pointer text-xs font-semibold">
              家庭から抜ける手続きを開く
            </summary>
            <form action={leaveHouseholdAction} className="pt-3">
              <SubmitButton
                className="text-destructive border-destructive/40 h-11"
                pendingLabel="処理中…"
              >
                <LogOut className="size-4" aria-hidden />
                「{overview.householdName}」から抜ける
              </SubmitButton>
            </form>
          </details>
        )}
      </section>

      {isOwner ? (
        // スマホだけ、下タブのすぐ上に招待フォームへの導線を置く（片手で届く位置）。
        <a
          href="#invite"
          className="bg-primary text-primary-foreground fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 mx-4 flex h-12 items-center justify-center gap-2 rounded-xl text-sm font-semibold shadow-lg md:hidden"
        >
          <Users className="size-4" aria-hidden />
          招待リンクを作る
        </a>
      ) : null}
    </>
  );
}
