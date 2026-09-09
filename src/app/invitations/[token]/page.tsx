import Link from "next/link";
import { redirect } from "next/navigation";
import { Boxes } from "lucide-react";

import { acceptInvitationAction } from "@/app/invitations/actions";
import { firstValue } from "@/components/inventory/chrome";
import { SubmitButton } from "@/components/inventory/submit-button";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import {
  checkInvitationAcceptable,
  hashInvitationToken,
  HOUSEHOLD_ROLE_LABELS,
  HOUSEHOLD_ROLE_NOTES,
} from "@/lib/household/members";
import { findInvitationByTokenHash } from "@/lib/household/queries";

/**
 * 招待リンクを開いた人に出す画面（#12）。
 *
 * リンクを知っていれば誰でも開けるので、**開けたこと自体は参加してよいことを意味しない**。
 * 宛先のメールアドレスと一致するか・期限内か・取り消されていないかを
 * `checkInvitationAcceptable()`が判定し、ここは結果を出し分けるだけにしてある。
 *
 * 参加できない理由を「無効なリンクです」でまとめないのは、宛先違い（ログインし直す）と
 * 期限切れ（発行し直してもらう）で次にやることが違うため。
 */
export default async function InvitationPage({ params, searchParams }: PageProps<"/invitations/[token]">) {
  const { token } = await params;
  const query = await searchParams;

  // 未ログインは`src/proxy.ts`が`/login?next=...`へ回すため、ここへは来ない。
  // それでも来た場合に招待の中身を見せないよう、fail-closedで戻す。
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/invitations/${token}`)}`);

  const invitation = await findInvitationByTokenHash(hashInvitationToken(token));

  if (!invitation) {
    return (
      <InvitationCard title="この招待リンクは見つかりませんでした">
        <p className="text-muted-foreground text-sm">
          リンクが途中で切れているか、すでに削除された家庭の招待かもしれません。
          招待した人にもう一度発行してもらってください。
        </p>
        <BackToApp />
      </InvitationCard>
    );
  }

  const alreadyMember = await db.householdMember.findFirst({
    where: { householdId: invitation.householdId, userId: user.id, removedAt: null },
    select: { id: true },
  });

  const check = checkInvitationAcceptable(invitation, user.email, alreadyMember !== null);
  const invitedBy = invitation.invitedBy?.name ?? invitation.invitedBy?.email ?? "不明";
  const error = firstValue(query.error);

  if (!check.ok) {
    return (
      <InvitationCard
        title={
          check.reason === "ALREADY_MEMBER"
            ? `すでに「${invitation.household.name}」のメンバーです`
            : "この招待は受け入れられません"
        }
      >
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm"
        >
          {check.message}
        </p>
        {check.reason === "EMAIL_MISMATCH" ? (
          <p className="text-muted-foreground text-xs">
            いまは {user.email ?? "メールアドレス未設定のアカウント"} でログインしています。
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {check.reason === "EMAIL_MISMATCH" ? (
            <form action="/auth/signout" method="post">
              <Button type="submit" variant="outline" className="h-11">
                別のアカウントでログインし直す
              </Button>
            </form>
          ) : null}
          <BackToApp />
        </div>
      </InvitationCard>
    );
  }

  return (
    <InvitationCard title={`「${invitation.household.name}」に招待されています`}>
      <p className="text-muted-foreground text-sm">
        参加すると、この家庭の在庫・期限・履歴・防災の集計を一緒に使えます。
      </p>

      {error ? (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm"
        >
          {error.slice(0, 200)}
        </p>
      ) : null}

      <dl className="divide-y rounded-xl border text-sm">
        <Row label="招待した人" value={invitedBy} />
        <Row
          label="あなたの役割"
          value={`${HOUSEHOLD_ROLE_LABELS[invitation.role]}（${HOUSEHOLD_ROLE_NOTES[invitation.role]}）`}
        />
        <Row
          label="有効期限"
          value={invitation.expiresAt.toLocaleString("ja-JP", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })}
        />
        <Row label="ログイン中" value={user.email ?? user.name ?? "利用者"} />
      </dl>

      <div className="flex flex-col gap-2 sm:flex-row">
        <form action={acceptInvitationAction} className="sm:flex-1">
          <input type="hidden" name="token" value={token} />
          <SubmitButton
            variant="default"
            className="h-12 w-full text-base"
            pendingLabel="参加しています…"
          >
            この家庭に参加する
          </SubmitButton>
        </form>
        <Button asChild variant="outline" className="h-12 text-base">
          <Link href="/inventory">参加しない</Link>
        </Button>
      </div>
    </InvitationCard>
  );
}

function InvitationCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-4 py-10 pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <div className="flex w-full max-w-lg flex-col gap-4 rounded-2xl border p-6">
        <div className="flex items-center gap-2">
          <span className="bg-primary text-primary-foreground grid size-7 place-items-center rounded-lg">
            <Boxes className="size-4" aria-hidden />
          </span>
          <span className="text-base font-semibold tracking-tight">Stockly</span>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {children}
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function BackToApp() {
  return (
    <Button asChild variant="outline" className="h-11 w-fit">
      <Link href="/inventory">在庫へ戻る</Link>
    </Button>
  );
}
