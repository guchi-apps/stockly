"use client";

import { useActionState, useState } from "react";
import { Check, Copy, Link2 } from "lucide-react";

import { inviteMemberAction } from "@/app/(app)/household/actions";
import {
  EMPTY_INVITE_FORM_STATE,
  type IssuedInvitation,
} from "@/app/(app)/household/form-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HOUSEHOLD_ROLE_LABELS, HOUSEHOLD_ROLE_NOTES, HOUSEHOLD_ROLES } from "@/lib/household/members";

/**
 * 招待リンクを発行するフォーム（#12）。
 *
 * メールを送る仕組みをまだ持たないため、**発行したリンクをこの場に出して手渡ししてもらう**。
 * 平文のトークンはDBに残らないので、閉じてしまうと同じリンクは二度と出せない
 * （そのときは発行し直す＝古いリンクは自動的に取り消される）。その旨を画面にも書く。
 */
export function InviteMemberForm() {
  const [state, formAction, pending] = useActionState(inviteMemberAction, EMPTY_INVITE_FORM_STATE);

  return (
    <section id="invite" className="flex scroll-mt-24 flex-col gap-3 border-t px-4 py-5 md:px-6">
      <div>
        <h2 className="text-sm font-semibold">招待リンクを作る</h2>
        <p className="text-muted-foreground text-xs">
          発行したリンクを本人へ渡します。リンクを開いてログインすると参加できます。
          宛先に指定したメールアドレスのアカウントだけが受け入れられ、有効期限は7日間です。
        </p>
      </div>

      <form action={formAction} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-email" className="text-xs font-semibold">
            宛先のメールアドレス
          </Label>
          <Input
            id="invite-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="off"
            defaultValue={state.values.email ?? ""}
            placeholder="例: family@example.com"
            required
            className="h-11 max-w-sm text-base"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-role" className="text-xs font-semibold">
            役割
          </Label>
          <select
            id="invite-role"
            name="role"
            defaultValue={state.values.role ?? "MEMBER"}
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-11 max-w-sm rounded-lg border px-3 text-base outline-none focus-visible:ring-3"
          >
            {HOUSEHOLD_ROLES.map((role) => (
              <option key={role} value={role}>
                {HOUSEHOLD_ROLE_LABELS[role]}（{HOUSEHOLD_ROLE_NOTES[role]}）
              </option>
            ))}
          </select>
        </div>

        {state.errors.form ? (
          <p role="alert" className="text-destructive text-xs font-semibold">
            {state.errors.form}
          </p>
        ) : null}

        <Button type="submit" className="h-11 px-6 md:self-start" disabled={pending}>
          {pending ? "発行中…" : "招待リンクを作る"}
        </Button>
      </form>

      {/* keyを付けて、発行し直したときにコピー済みの表示が残らないようにする。 */}
      {state.issued ? <IssuedLink key={state.issued.path} issued={state.issued} /> : null}
    </section>
  );
}

function IssuedLink({ issued }: { issued: IssuedInvitation }) {
  // オリジンは画面側で足す。サーバー側で組むとリバースプロキシのヘッダーを信じることになり、
  // `getRequestOrigin()`と同じ判断をもう1か所へ持つことになるため（#34）。
  // このカードは発行に成功したあと（＝クライアント側の再描画）にしか出ないが、
  // 念のためサーバー側で描かれても落ちない形にしておく。
  const url =
    typeof window === "undefined" ? issued.path : `${window.location.origin}${issued.path}`;
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // クリップボードはhttpsかlocalhostでしか使えない。使えないときは
      // 下の入力欄から手で選んでもらう（値そのものは出したままにする）。
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-900 dark:text-emerald-100">
        <Link2 className="size-4" aria-hidden />
        {issued.email} への招待リンクを発行しました
      </p>
      <p className="text-xs text-emerald-900/80 dark:text-emerald-100/80">
        役割は{issued.roleLabel}、
        {new Date(issued.expiresAt).toLocaleString("ja-JP", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })}
        まで有効です。<b>このリンクを出せるのはいまだけです</b>（保存していないため、
        閉じたら発行し直してください）。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          readOnly
          value={url}
          aria-label="招待リンク"
          onFocus={(event) => event.currentTarget.select()}
          className="h-10 min-w-0 flex-1 bg-white font-mono text-xs dark:bg-black/20"
        />
        <Button type="button" variant="outline" className="h-10" onClick={copy}>
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {copied ? "コピーしました" : "リンクをコピー"}
        </Button>
      </div>
    </div>
  );
}
