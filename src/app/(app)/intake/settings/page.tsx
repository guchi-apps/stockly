import Link from "next/link";
import { ArrowLeft, MapPin, Trash2 } from "lucide-react";

import { deleteIntakeImagesAction, saveIntakeSettingsAction } from "@/app/(app)/intake/actions";
import { IntakeSettingsForm } from "@/components/intake/intake-settings-form";
import { ActionNotice, EmptyState, PageHeader, firstValue } from "@/components/inventory/chrome";
import { Button } from "@/components/ui/button";
import { requireInventoryContext } from "@/lib/inventory/context";
import { INTAKE_CREDENTIAL_ENV_KEYS, readIntakeConfig } from "@/lib/intake/config";
import { getIntakeOverview } from "@/lib/intake/queries";
import { formatTokyoDate } from "@/lib/time/tokyo";

export default async function IntakeSettingsPage({ searchParams }: PageProps<"/intake/settings">) {
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

  const config = readIntakeConfig();
  const { settings, storedImages } = await getIntakeOverview(ctx);

  return (
    <>
      <PageHeader
        title="写真取込の設定"
        description={`${householdName ? `${householdName} ・ ` : ""}画像の保存・送る範囲・費用の上限`}
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/intake">
              <ArrowLeft className="size-4" aria-hidden />
              写真から登録
            </Link>
          </Button>
        }
      />

      <ActionNotice notice={firstValue(params.notice)} error={firstValue(params.error)} />

      <div className="px-4 pt-4 md:px-6">
        {config ? (
          <p className="text-muted-foreground bg-muted rounded-lg border px-3 py-2 text-xs">
            AIの資格情報は設定済みです（
            {config.credential.kind === "apiKey" ? "APIキー" : "アクセストークン"}）。
            値はサーバーの環境変数にだけあり、この画面には出しません。
          </p>
        ) : (
          <p
            role="alert"
            className="border-destructive/40 text-destructive rounded-lg border px-3 py-2 text-xs"
          >
            <b>AIの資格情報が未設定です。</b>
            この画面と手入力での登録はいまも使えますが、写真からの読み取りだけができません。
            サーバーの環境変数に {INTAKE_CREDENTIAL_ENV_KEYS.join(" か ")} を設定してください。
          </p>
        )}
      </div>

      <div className="px-4 pt-4 md:px-6">
        <section className="flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm">
              いま保存されている画像 <b className="tabular-nums">{storedImages.count}枚</b>
              <span className="text-muted-foreground"> （{formatBytes(storedImages.bytes)}）</span>
            </p>
            <p className="text-muted-foreground text-xs">
              {storedImages.oldestAt
                ? `いちばん古いもの ${formatTokyoDate(storedImages.oldestAt)}`
                : "保存されている画像はありません"}
              ・削除しても候補と、反映した在庫は残ります
            </p>
          </div>
          {storedImages.count > 0 ? (
            <form action={deleteIntakeImagesAction}>
              <Button type="submit" variant="outline" size="sm">
                <Trash2 className="size-3.5" aria-hidden />
                すべて削除する
              </Button>
            </form>
          ) : null}
        </section>
      </div>

      <IntakeSettingsForm
        action={saveIntakeSettingsAction}
        defaultModel={config?.defaultModel ?? "claude-sonnet-5"}
        initial={{
          imageRetentionDays: settings.imageRetentionDays,
          sendProductNames: settings.sendProductNames,
          monthlyRequestLimit: settings.monthlyRequestLimit,
          monthlyCostLimitYen: settings.monthlyCostLimitYen,
          stopOnLimit: settings.stopOnLimit,
          model: settings.model,
        }}
      />
    </>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
