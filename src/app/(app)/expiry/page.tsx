import Link from "next/link";
import { CalendarClock, MapPin, Settings2 } from "lucide-react";

import { ActionNotice, EmptyState, PageHeader, firstValue } from "@/components/inventory/chrome";
import { ConsumptionCandidates } from "@/components/inventory/consumption-candidates";
import { ExpirySummary } from "@/components/inventory/expiry-summary";
import { NotificationPanel } from "@/components/inventory/notification-panel";
import { Button } from "@/components/ui/button";
import { requireInventoryContext } from "@/lib/inventory/context";
import { getExpiryOverview } from "@/lib/inventory/queries";
import { countUnreadNotifications, listNotifications } from "@/lib/notifications/inbox";
import { formatTokyoDate } from "@/lib/time/tokyo";
import { tokyoToday } from "@/lib/time/tokyo";

/** 消費候補は組ごとにこの件数まで。全部出すと、いちばん急ぐものが画面外へ押し出される。 */
const CANDIDATES_PER_GROUP = 15;

export default async function ExpiryPage({ searchParams }: PageProps<"/expiry">) {
  const params = await searchParams;
  const { ctx, householdName } = await requireInventoryContext();

  if (!ctx) {
    return (
      <EmptyState
        icon={<MapPin className="size-8" />}
        title="家庭が見つかりません"
        description="在庫は家庭に属します。ログインし直しても表示されない場合は、管理者に連絡してください。"
      />
    );
  }

  const [overview, notifications, unreadCount] = await Promise.all([
    getExpiryOverview(ctx, { limitPerGroup: CANDIDATES_PER_GROUP }),
    listNotifications(ctx, { limit: 5 }),
    countUnreadNotifications(ctx),
  ]);

  const { settings, summary, groups } = overview;
  const soonDaysNote = `賞味${settings.bestBeforeSoonDays}日・消費${settings.useBySoonDays}日以内`;

  return (
    <>
      <PageHeader
        title="期限"
        description={`${householdName ? `${householdName} ・ ` : ""}${formatTokyoDate(tokyoToday())}時点`}
        actions={
          <Button asChild variant="outline">
            <Link href="/expiry/settings">
              <Settings2 className="size-4" aria-hidden />
              期限の設定
            </Link>
          </Button>
        }
      />

      <ActionNotice notice={firstValue(params.notice)} error={firstValue(params.error)} />

      <ExpirySummary summary={summary} soonDaysNote={soonDaysNote} />

      <section>
        <div className="flex items-baseline gap-2 px-4 md:px-6">
          <h2 className="text-sm font-semibold">先に消費する候補</h2>
          <span className="text-muted-foreground text-xs">期限が早い順（FEFO）</span>
        </div>

        {groups.length === 0 ? (
          <p className="text-muted-foreground mx-4 mt-3 rounded-lg border border-dashed px-3 py-6 text-center text-xs leading-relaxed md:mx-6">
            いま急いで消費すべき在庫はありません。
            {summary.unknown > 0 && !settings.highlightUnknownExpiry ? (
              <>
                <br />
                期限が未入力の在庫が{summary.unknown}件あります（設定で候補から外しています）。
              </>
            ) : null}
          </p>
        ) : (
          <div className="mt-2">
            <ConsumptionCandidates groups={groups} redirectTo="/expiry" />
          </div>
        )}
      </section>

      <NotificationPanel
        notifications={notifications}
        unreadCount={unreadCount}
        redirectTo="/expiry"
        notifyEnabled={settings.notifyEnabled}
      />

      <p className="text-muted-foreground flex items-center gap-1.5 px-4 pb-6 text-xs md:px-6">
        <CalendarClock className="size-3.5" aria-hidden />
        期限の判定は日本時間の0時で切り替わります。
      </p>
    </>
  );
}
