import { markNotificationsReadAction, runExpiryCheckAction } from "@/app/(app)/actions";
import { SubmitButton } from "@/components/inventory/submit-button";
import { AVAILABLE_CHANNELS, resolveChannels } from "@/lib/notifications/channels";
import type { NotificationRow } from "@/lib/notifications/inbox";
import { formatTokyoDateTime } from "@/lib/time/tokyo";

/**
 * 通知の記録と、手で1回動かすためのボタン。
 *
 * **送らなかったことも並べる。** 「同じ内容だったので送っていない」が見えないと、
 * 通知が来ないときに、重複防止が効いているのか通知そのものが壊れているのかを判断できない。
 */
export function NotificationPanel({
  notifications,
  unreadCount,
  redirectTo,
  notifyEnabled,
}: {
  notifications: readonly NotificationRow[];
  unreadCount: number;
  redirectTo: string;
  notifyEnabled: boolean;
}) {
  const activeKeys = new Set(resolveChannels().map((channel) => channel.key));
  const channelLabels = AVAILABLE_CHANNELS.filter((channel) => activeKeys.has(channel.key))
    .map((channel) => channel.label)
    .join(" ・ ");

  return (
    <section className="px-4 py-4 md:px-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <h2 className="text-sm font-semibold">通知</h2>
        <span className="text-muted-foreground text-xs">
          {notifyEnabled
            ? `送り先: ${channelLabels}。同じ在庫・同じ状態につき1回だけ送ります`
            : "設定でオフになっています"}
        </span>
        <span className="flex-1" />

        {unreadCount > 0 ? (
          <form action={markNotificationsReadAction}>
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <SubmitButton variant="ghost" className="h-9">
              {unreadCount}件を既読にする
            </SubmitButton>
          </form>
        ) : null}

        <form action={runExpiryCheckAction}>
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <SubmitButton variant="outline" className="h-9" pendingLabel="確認中…">
            いま期限を確認する
          </SubmitButton>
        </form>
      </div>

      {notifications.length === 0 ? (
        <p className="text-muted-foreground mt-3 rounded-lg border border-dashed px-3 py-4 text-xs leading-relaxed">
          まだ通知はありません。期限切れ・期限間近の在庫が出ると、ここに残ります。
          サーバーからの定期実行（1日1回）に加えて、「いま期限を確認する」で手動でも動かせます。
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {notifications.map((notification) => (
            <li
              key={notification.id}
              className={
                notification.status === "FAILED"
                  ? "border-destructive/40 bg-destructive/5 flex gap-3 rounded-lg border px-3 py-2.5"
                  : "flex gap-3 rounded-lg border px-3 py-2.5"
              }
            >
              <span className="text-muted-foreground w-24 shrink-0 text-xs tabular-nums">
                {formatTokyoDateTime(notification.sentAt)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  {notification.readAt === null && notification.status === "SENT" ? (
                    <span
                      className="bg-primary mr-1.5 inline-block size-1.5 rounded-full align-middle"
                      aria-label="未読"
                    />
                  ) : null}
                  {notification.title}
                </p>
                <p className="text-muted-foreground text-xs break-words">{notification.body}</p>
                <p className="text-muted-foreground text-[11px]">
                  {channelLabel(notification.channel)}
                  {notification.status === "FAILED" ? " ・ 送信に失敗しました" : " ・ 送信済み"}
                  {notification.suppressedCount > 0 && notification.lastSuppressedAt
                    ? ` ・ 同じ内容のため${notification.suppressedCount}回見送り（最後は${formatTokyoDateTime(notification.lastSuppressedAt)}）`
                    : null}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function channelLabel(key: NotificationRow["channel"]): string {
  return AVAILABLE_CHANNELS.find((channel) => channel.key === key)?.label ?? key;
}
