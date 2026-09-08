/**
 * 通知の型。**送り先（チャネル）と、送る中身と、送った記録を分ける**ための境界。
 *
 * 送り先を増やすときに触るのは`channels.ts`と`prisma/schema.prisma`の`NotificationChannel`だけで、
 * 中身を組み立てる側（`expiry-message.ts`）と重複防止（`service.ts`）は触らない。
 * メール・LINEのような外部サービスは、導入の可否をユーザーへ確認してから足す。
 */
import type { $Enums } from "@prisma/client";

export type NotificationChannelKey = $Enums.NotificationChannel;
export type NotificationKindKey = $Enums.NotificationKind;

/** 送る中身。どのチャネルへ送っても同じものを渡す。 */
export interface NotificationMessage {
  readonly householdId: string;
  readonly kind: NotificationKindKey;
  /**
   * 同じ通知かどうかの判定キー。**送る側ではなく作る側が決める**
   * （期限なら「対象ロットとその状態の組み合わせ」。`expiry-message.ts`）。
   */
  readonly dedupeKey: string;
  readonly title: string;
  readonly body: string;
  readonly payload?: Record<string, unknown>;
}

/** 送った記録の識別子。チャネルが本文へ差し込めるよう`send()`へ渡す。 */
export interface NotificationDeliveryRef {
  readonly id: string;
}

/**
 * 通知の送り先。
 *
 * `send()`が呼ばれる時点で、重複でないことの判定と記録は`service.ts`が済ませている。
 * ここでは送ることだけを行い、失敗したら例外を投げる（`service.ts`が記録を`FAILED`にする）。
 */
export interface NotificationChannel {
  readonly key: NotificationChannelKey;
  readonly label: string;
  send(message: NotificationMessage, delivery: NotificationDeliveryRef): Promise<void>;
}
