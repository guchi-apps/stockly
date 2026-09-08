import Link from "next/link";
import { ArrowLeft, MapPin } from "lucide-react";

import { saveExpirySettingsAction } from "@/app/(app)/actions";
import { ActionNotice, EmptyState, PageHeader, firstValue } from "@/components/inventory/chrome";
import { ExpirySettingsForm } from "@/components/inventory/expiry-settings-form";
import { Button } from "@/components/ui/button";
import { requireInventoryContext } from "@/lib/inventory/context";
import { getExpirySettings } from "@/lib/inventory/settings";
import { AVAILABLE_CHANNELS, resolveChannels } from "@/lib/notifications/channels";

export default async function ExpirySettingsPage({ searchParams }: PageProps<"/expiry/settings">) {
  const params = await searchParams;
  const { ctx, householdName } = await requireInventoryContext();

  if (!ctx) {
    return (
      <EmptyState
        icon={<MapPin className="size-8" />}
        title="家庭が見つかりません"
        description="設定は家庭ごとに保存します。ログインし直しても表示されない場合は、管理者に連絡してください。"
      />
    );
  }

  const settings = await getExpirySettings(ctx);
  const activeKeys = new Set(resolveChannels().map((channel) => channel.key));
  const channels = AVAILABLE_CHANNELS.map((channel) => ({
    key: channel.key,
    label: channel.label,
    active: activeKeys.has(channel.key),
  }));

  return (
    <>
      <PageHeader
        title="期限の設定"
        description={`${householdName ? `${householdName} ・ ` : ""}家族全員に同じ設定が効きます`}
        actions={
          <Button asChild variant="ghost">
            <Link href="/expiry">
              <ArrowLeft className="size-4" aria-hidden />
              期限
            </Link>
          </Button>
        }
      />

      <ActionNotice notice={firstValue(params.notice)} error={firstValue(params.error)} />

      <ExpirySettingsForm
        action={saveExpirySettingsAction}
        initial={{
          bestBeforeSoonDays: settings.bestBeforeSoonDays,
          useBySoonDays: settings.useBySoonDays,
          highlightUnknownExpiry: settings.highlightUnknownExpiry,
          notifyEnabled: settings.notifyEnabled,
        }}
        channels={channels}
      />
    </>
  );
}
