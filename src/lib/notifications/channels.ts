/**
 * 通知の送り先。**差し替え口はここ1か所**で、増やすときは
 * `prisma/schema.prisma`の`NotificationChannel`にも同じ値を足す。
 *
 * どれを使うかは環境変数`STOCKLY_NOTIFY_CHANNELS`（カンマ区切り）で決める。未設定なら
 * アプリ内のお知らせだけ。**外部サービス（メール・LINE等）はまだ実装していない。**
 * 追加には送信先の決定とシークレットの用意が要るため、ユーザーへ確認してから足す。
 */
import type {
  NotificationChannel,
  NotificationChannelKey,
  NotificationMessage,
} from "./types.ts";

/**
 * アプリ内のお知らせ。
 *
 * `NotificationDelivery`の行そのものが本体なので、ここでは何もしない
 * （記録は`service.ts`が済ませている）。行を二重に作らないため、ここでDBへ書かないこと。
 */
export const IN_APP_CHANNEL: NotificationChannel = {
  key: "IN_APP",
  label: "アプリ内のお知らせ",
  async send(): Promise<void> {},
};

/** サーバーログ。無人実行（cron）で動かしたときに、届いた内容をログから追えるようにする。 */
export const LOG_CHANNEL: NotificationChannel = {
  key: "LOG",
  label: "サーバーログ",
  async send(message: NotificationMessage): Promise<void> {
    console.info(
      `[stockly][notify] household=${message.householdId} ${message.title} / ${message.body}`,
    );
  },
};

export const AVAILABLE_CHANNELS: readonly NotificationChannel[] = [IN_APP_CHANNEL, LOG_CHANNEL];

/** 未設定のときの送り先。アプリ内だけにしてあるのは、ログを騒がせないため。 */
export const DEFAULT_CHANNEL_KEYS: readonly NotificationChannelKey[] = ["IN_APP"];

/**
 * `STOCKLY_NOTIFY_CHANNELS`の値を送り先の一覧へ直す。
 *
 * 知らない名前は黙って落とす（設定の打ち間違いで通知が全部止まるより、既定へ戻るほうが安全）。
 * 結果が空になった場合も既定に戻す。
 */
export function parseChannelKeys(raw: string | undefined | null): NotificationChannelKey[] {
  const names = (raw ?? "")
    .split(",")
    .map((name) => name.trim().toUpperCase())
    .filter((name) => name !== "");

  const keys = names.filter((name): name is NotificationChannelKey =>
    AVAILABLE_CHANNELS.some((channel) => channel.key === name),
  );

  const unique = [...new Set(keys)];
  return unique.length > 0 ? unique : [...DEFAULT_CHANNEL_KEYS];
}

/** いま有効な送り先。 */
export function resolveChannels(
  raw: string | undefined | null = process.env.STOCKLY_NOTIFY_CHANNELS,
): NotificationChannel[] {
  const keys = parseChannelKeys(raw);
  return AVAILABLE_CHANNELS.filter((channel) => keys.includes(channel.key));
}
