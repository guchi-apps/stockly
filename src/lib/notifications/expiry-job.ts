/**
 * 期限の通知ジョブ。家庭ごとに「いま期限切れ・期限間近のもの」を集め、通知を1件送る。
 *
 * 呼ばれ方は2つあり、どちらも同じこの関数を通る。
 *
 * - `pnpm job:expiry`（`scripts/run-expiry-notifications.ts`）。サーバーのcronから1日1回
 * - 期限の画面の「いま期限を確認する」。押した人の家庭だけを対象に実行する
 *
 * **PrismaClientもチャネルも引数で受け取る。** Next.jsのパスエイリアス（`@/`）を使わないので、
 * `node`から直接実行でき、テストでは差し替えられる。
 *
 * 家庭の境界について: このジョブは利用者ではなくシステムとして動くため`scopeToHousehold()`は
 * 通らない。代わりに**家庭を1つずつ取り出し、その`householdId`だけをwhereに使う**
 * （複数家庭をまたいで集計しない）。
 */
import type { PrismaClient } from "@prisma/client";

import {
  DEFAULT_EXPIRY_POLICY,
  resolveExpiry,
  type ExpiryPolicy,
} from "../inventory/operations.ts";

import { resolveChannels } from "./channels.ts";
import { buildExpiryNotification, type ExpiryTarget } from "./expiry-message.ts";
import { dispatchNotification, type DispatchResult } from "./service.ts";
import type { NotificationChannel } from "./types.ts";

export interface ExpiryJobOptions {
  /** 「いま」。テストとcronの実行時刻を固定するために渡せる。 */
  readonly now?: Date;
  /** 対象の家庭。省略時は全家庭。 */
  readonly householdIds?: readonly string[];
  /** 送り先。省略時は`STOCKLY_NOTIFY_CHANNELS`から決める。 */
  readonly channels?: readonly NotificationChannel[];
}

export type ExpiryJobSkipReason = "notify-disabled" | "no-targets";

export interface ExpiryJobHouseholdResult {
  readonly householdId: string;
  readonly householdName: string;
  readonly targets: number;
  readonly skipped: ExpiryJobSkipReason | null;
  readonly results: readonly DispatchResult[];
}

export interface ExpiryJobSummary {
  readonly households: number;
  readonly sent: number;
  readonly duplicate: number;
  readonly failed: number;
  readonly details: readonly ExpiryJobHouseholdResult[];
}

/** 家庭の設定（無ければ既定値）。 */
export function toExpiryPolicy(
  setting: { bestBeforeSoonDays: number; useBySoonDays: number } | null | undefined,
): ExpiryPolicy {
  if (!setting) return DEFAULT_EXPIRY_POLICY;
  return {
    bestBeforeSoonDays: setting.bestBeforeSoonDays,
    useBySoonDays: setting.useBySoonDays,
  };
}

export async function runExpiryNotifications(
  db: PrismaClient,
  options: ExpiryJobOptions = {},
): Promise<ExpiryJobSummary> {
  const now = options.now ?? new Date();
  const channels = options.channels ?? resolveChannels();

  const households = await db.household.findMany({
    where: options.householdIds ? { id: { in: [...options.householdIds] } } : {},
    select: { id: true, name: true, expirySetting: true },
    orderBy: { createdAt: "asc" },
  });

  const details: ExpiryJobHouseholdResult[] = [];
  let sent = 0;
  let duplicate = 0;
  let failed = 0;

  for (const household of households) {
    const base = { householdId: household.id, householdName: household.name };

    if (household.expirySetting && !household.expirySetting.notifyEnabled) {
      details.push({ ...base, targets: 0, skipped: "notify-disabled", results: [] });
      continue;
    }

    const targets = await collectExpiryTargets(db, household.id, now, toExpiryPolicy(household.expirySetting));
    const draft = buildExpiryNotification(targets);
    if (!draft) {
      details.push({ ...base, targets: 0, skipped: "no-targets", results: [] });
      continue;
    }

    const results = await dispatchNotification(
      db,
      {
        householdId: household.id,
        kind: "EXPIRY",
        dedupeKey: draft.dedupeKey,
        title: draft.title,
        body: draft.body,
        payload: draft.payload,
      },
      channels,
    );

    for (const result of results) {
      if (result.outcome === "sent") sent += 1;
      else if (result.outcome === "duplicate") duplicate += 1;
      else failed += 1;
    }

    details.push({ ...base, targets: targets.length, skipped: null, results });
  }

  return { households: households.length, sent, duplicate, failed, details };
}

/**
 * その家庭で通知すべきロット。
 *
 * 期限が入っていないもの（要確認）は通知しない。**画面では埋もれないように先頭へ出すが、
 * 通知にすると「期限を入れていない在庫の数だけ毎回鳴る」ことになり、肝心の期限切れが埋もれる。**
 */
async function collectExpiryTargets(
  db: PrismaClient,
  householdId: string,
  now: Date,
  policy: ExpiryPolicy,
): Promise<ExpiryTarget[]> {
  const lots = await db.stockLot.findMany({
    where: {
      householdId,
      status: "ACTIVE",
      quantity: { gt: 0 },
      OR: [{ bestBeforeDate: { not: null } }, { useByDate: { not: null } }],
    },
    select: {
      id: true,
      bestBeforeDate: true,
      useByDate: true,
      product: { select: { name: true } },
    },
  });

  const targets: ExpiryTarget[] = [];
  for (const lot of lots) {
    const expiry = resolveExpiry(lot, now, policy);
    if (expiry.status !== "EXPIRED" && expiry.status !== "SOON") continue;
    targets.push({
      lotId: lot.id,
      productName: lot.product.name,
      status: expiry.status,
      daysLeft: expiry.daysLeft ?? 0,
    });
  }
  return targets;
}
