/**
 * 通知を送り、送った記録を残す。**重複通知を防ぐのはここ1か所**。
 *
 * 仕組みは在庫の二重送信対策（`InventoryTransaction`の主キー）と同じ考え方で、
 * 専用のフラグを持たず**DBの一意制約そのものを判定に使う**。
 * `NotificationDelivery`に`@@unique([householdId, channel, dedupeKey])`があるので、
 * 2回目の送信はINSERTの時点で弾かれる。弾かれたら送らず、既存の行の`suppressedCount`を増やす
 * （「送らなかったこと」も記録に残す。何も残さないと、届かないのが正常なのか不具合なのか分からない）。
 *
 * PrismaClientは引数で受け取る。画面からは`@/lib/db`の1つを、cronからは
 * `scripts/run-expiry-notifications.ts`が作ったものを渡す（このモジュールがNext.jsの
 * パスエイリアスに依存しないため、`node`から直接実行できる）。
 */
import { Prisma, type PrismaClient } from "@prisma/client";

import type { NotificationChannel, NotificationMessage } from "./types.ts";

export type DispatchOutcome = "sent" | "duplicate" | "failed";

export interface DispatchResult {
  readonly channel: string;
  readonly outcome: DispatchOutcome;
  readonly deliveryId: string | null;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * 1件の通知を、渡されたすべての送り先へ送る。
 *
 * 送り先ごとに独立して重複を判定する（アプリ内には届いたがログには出ていない、という
 * 中途半端な状態を次回の実行で埋められるようにするため）。
 */
export async function dispatchNotification(
  db: PrismaClient,
  message: NotificationMessage,
  channels: readonly NotificationChannel[],
): Promise<DispatchResult[]> {
  const results: DispatchResult[] = [];

  for (const channel of channels) {
    results.push(await dispatchToChannel(db, message, channel));
  }

  return results;
}

async function dispatchToChannel(
  db: PrismaClient,
  message: NotificationMessage,
  channel: NotificationChannel,
): Promise<DispatchResult> {
  let delivery: { id: string };

  try {
    delivery = await db.notificationDelivery.create({
      data: {
        householdId: message.householdId,
        kind: message.kind,
        channel: channel.key,
        dedupeKey: message.dedupeKey,
        title: message.title,
        body: message.body,
        payload: (message.payload ?? undefined) as Prisma.InputJsonValue | undefined,
      },
      select: { id: true },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    const existing = await db.notificationDelivery.update({
      where: {
        householdId_channel_dedupeKey: {
          householdId: message.householdId,
          channel: channel.key,
          dedupeKey: message.dedupeKey,
        },
      },
      data: { suppressedCount: { increment: 1 }, lastSuppressedAt: new Date() },
      select: { id: true },
    });
    return { channel: channel.key, outcome: "duplicate", deliveryId: existing.id };
  }

  try {
    await channel.send(message, delivery);
    return { channel: channel.key, outcome: "sent", deliveryId: delivery.id };
  } catch (error) {
    // 失敗した記録は残しつつ、**次の実行で送り直せるようにdedupeKeyを別の値へ退避する**。
    // ここで元のキーのまま残すと、次回は「送信済み」と見なされて永久に届かない。
    await db.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "FAILED",
        error: error instanceof Error ? error.message : String(error),
        dedupeKey: `failed:${delivery.id}`.slice(0, 120),
      },
    });
    return { channel: channel.key, outcome: "failed", deliveryId: delivery.id };
  }
}
