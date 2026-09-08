"use client";

import { useActionState } from "react";
import Link from "next/link";

import { EMPTY_FORM_STATE, type InventoryFormState } from "@/app/(app)/form-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * 期限の設定フォーム。
 *
 * 賞味期限と消費期限で日数を分けているのは、切れたときの困り方が違うため。
 * 送り先（チャネル）はサーバー側の設定値なので、ここでは**いま何が有効かを見せるだけ**にする
 * （画面から外部サービスを勝手に有効化できないようにする）。
 */
export interface ChannelStatus {
  key: string;
  label: string;
  active: boolean;
}

export function ExpirySettingsForm({
  action,
  initial,
  channels,
}: {
  action: (state: InventoryFormState, formData: FormData) => Promise<InventoryFormState>;
  initial: {
    bestBeforeSoonDays: number;
    useBySoonDays: number;
    highlightUnknownExpiry: boolean;
    notifyEnabled: boolean;
  };
  channels: readonly ChannelStatus[];
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_FORM_STATE);

  const value = (key: keyof typeof initial): string =>
    state.values[key] ?? String(initial[key as "bestBeforeSoonDays" | "useBySoonDays"]);
  const checked = (key: "highlightUnknownExpiry" | "notifyEnabled"): boolean =>
    Object.keys(state.values).length > 0 ? state.values[key] === "on" : initial[key];

  return (
    <form action={formAction} className="flex flex-1 flex-col">
      {state.errors.form ? (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/10 text-destructive mx-4 mt-4 rounded-lg border px-3 py-2 text-sm md:mx-6"
        >
          {state.errors.form}
        </p>
      ) : null}

      <div className="flex flex-col gap-4 px-4 py-4 md:px-6">
        <section className="flex flex-col gap-3 rounded-xl border px-4 py-4">
          <div>
            <h2 className="text-sm font-semibold">期限間近とみなす日数</h2>
            <p className="text-muted-foreground text-xs">
              残りがこの日数になったら「期限間近」として一覧の先頭と通知に出します。0を入れると当日だけになります。
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <DaysField
              id="bestBeforeSoonDays"
              label="賞味期限"
              hint="品質が保たれる期限。少し過ぎても食べられることが多い"
              defaultValue={value("bestBeforeSoonDays")}
              error={state.errors.bestBeforeSoonDays}
            />
            <DaysField
              id="useBySoonDays"
              label="消費期限"
              hint="安全に食べられる期限。過ぎたら食べない"
              defaultValue={value("useBySoonDays")}
              error={state.errors.useBySoonDays}
            />
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="highlightUnknownExpiry"
              defaultChecked={checked("highlightUnknownExpiry")}
              className="mt-0.5 size-4"
            />
            <span>
              期限が未入力の在庫を「要確認」として消費候補に出す
              <span className="text-muted-foreground block text-xs">
                どちらでも期限内とはみなしません。オフにすると消費候補には並びませんが、件数と絞り込みには残ります。
              </span>
            </span>
          </label>

          <p className="text-muted-foreground text-xs leading-relaxed">
            日付の境目は日本時間（Asia/Tokyo）の0時です。0時を過ぎると「今日まで」は「期限切れ」に変わります。
          </p>
        </section>

        <section className="flex flex-col gap-3 rounded-xl border px-4 py-4">
          <div>
            <h2 className="text-sm font-semibold">通知</h2>
            <p className="text-muted-foreground text-xs">
              期限切れと期限間近をまとめて知らせます。同じ在庫は、状態が変わるまで1回しか通知しません。
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="notifyEnabled"
              defaultChecked={checked("notifyEnabled")}
              className="size-4"
            />
            期限の通知を受け取る
          </label>

          <ul className="flex flex-col divide-y rounded-lg border">
            {channels.map((channel) => (
              <li key={channel.key} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="flex-1">{channel.label}</span>
                <span
                  className={
                    channel.active
                      ? "rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300"
                      : "text-muted-foreground rounded-full border px-2 py-0.5 text-[11px]"
                  }
                >
                  {channel.active ? "有効" : "無効"}
                </span>
              </li>
            ))}
            <li className="text-muted-foreground flex items-center gap-2 px-3 py-2 text-sm">
              <span className="flex-1">メール ・ LINE</span>
              <span className="rounded-full border px-2 py-0.5 text-[11px]">未接続</span>
            </li>
          </ul>

          <p className="text-muted-foreground text-xs leading-relaxed">
            送り先はサーバーの設定（<code>STOCKLY_NOTIFY_CHANNELS</code>）で切り替えます。メール・LINEはまだ
            実装していません。定期実行はサーバーのcronから1日1回（<code>pnpm job:expiry</code>）で、
            <Link href="/expiry" className="underline underline-offset-2">
              期限
            </Link>
            の「いま期限を確認する」からは手動でも動かせます。
          </p>
        </section>
      </div>

      <div className="bg-background sticky bottom-0 mt-auto flex gap-2 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6">
        <Button asChild variant="outline" className="h-11 flex-1">
          <Link href="/expiry">期限へ戻る</Link>
        </Button>
        <Button type="submit" className="h-11 flex-1" disabled={pending}>
          {pending ? "保存中…" : "保存"}
        </Button>
      </div>
    </form>
  );
}

function DaysField({
  id,
  label,
  hint,
  defaultValue,
  error,
}: {
  id: string;
  label: string;
  hint: string;
  defaultValue: string;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs font-semibold">
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          name={id}
          inputMode="numeric"
          defaultValue={defaultValue}
          required
          className="h-11 w-24 text-right text-base tabular-nums"
        />
        <span className="text-muted-foreground text-sm">日前から</span>
      </div>
      {error ? (
        <p role="alert" className="text-destructive text-xs font-semibold">
          {error}
        </p>
      ) : (
        <p className="text-muted-foreground text-xs">{hint}</p>
      )}
    </div>
  );
}
