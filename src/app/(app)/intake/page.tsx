import Link from "next/link";
import { MapPin, Pencil, SlidersHorizontal } from "lucide-react";

import { createIntakeAction } from "@/app/(app)/intake/actions";
import { PhotoUploadForm } from "@/components/intake/photo-upload-form";
import { ActionNotice, EmptyState, PageHeader, firstValue } from "@/components/inventory/chrome";
import { Button } from "@/components/ui/button";
import { requireInventoryContext } from "@/lib/inventory/context";
import {
  MAX_IMAGES_PER_BATCH,
  estimateBatchCostYen,
  readIntakeConfig,
} from "@/lib/intake/config";
import { INTAKE_IMAGE_KIND_LABELS, type IntakeImageKind } from "@/lib/intake/prompt";
import { getIntakeOverview, listIntakeBatches, type IntakeBatchRow } from "@/lib/intake/queries";
import { purgeExpiredIntakeImages } from "@/lib/intake/service";
import { resolveModel } from "@/lib/intake/settings";
import { formatTokyoDateTime } from "@/lib/time/tokyo";

/**
 * 写真から在庫を登録する入口（#10）。
 *
 * **保存期間を過ぎた画像の掃除をここで走らせる。** cronを1つ増やすより、写真を扱う画面を
 * 開いたときにまとめて消すほうが、置き場所が増えず追いやすい（1家庭あたりの枚数はたかが知れている）。
 */
export default async function IntakePage({ searchParams }: PageProps<"/intake">) {
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

  await purgeExpiredIntakeImages(ctx);

  const config = readIntakeConfig();
  const [overview, batches] = await Promise.all([
    getIntakeOverview(ctx),
    listIntakeBatches(ctx, { limit: 10 }),
  ]);

  const model = resolveModel(overview.settings, config?.defaultModel ?? "claude-sonnet-5");
  const { settings, usage } = overview;

  const requestLimitReached =
    settings.stopOnLimit &&
    settings.monthlyRequestLimit > 0 &&
    usage.requestCount >= settings.monthlyRequestLimit;
  const costLimitReached =
    settings.stopOnLimit &&
    settings.monthlyCostLimitYen > 0 &&
    usage.costYen >= settings.monthlyCostLimitYen;

  const blocked = !config || requestLimitReached || costLimitReached;
  const blockedReason = !config
    ? "AIの資格情報が未設定のため読み取りはできません。手入力での登録は使えます。"
    : requestLimitReached
      ? "今月の読み取り回数が上限に達しました。設定から上限を変えられます。"
      : costLimitReached
        ? "今月の概算の費用が上限に達しました。設定から上限を変えられます。"
        : undefined;

  return (
    <>
      <PageHeader
        title="写真から登録"
        description={`${householdName ? `${householdName} ・ ` : ""}レシート・購入品・期限ラベルから候補を作ります`}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/intake/settings">
              <SlidersHorizontal className="size-4" aria-hidden />
              設定
            </Link>
          </Button>
        }
      />

      <ActionNotice notice={firstValue(params.notice)} error={firstValue(params.error)} />

      <div className="flex flex-col gap-4 px-4 py-4 md:px-6">
        <PhotoUploadForm
          action={createIntakeAction}
          maxImages={MAX_IMAGES_PER_BATCH}
          disabled={blocked}
          disabledReason={blockedReason}
        />

        <div className="grid gap-4 md:grid-cols-2">
          <section className="flex flex-col gap-3 rounded-xl border px-4 py-4">
            <div className="flex items-baseline gap-3">
              <h2 className="text-sm font-semibold">今月の使用</h2>
              <p className="text-muted-foreground ml-auto text-xs">
                {settings.stopOnLimit ? "上限に達すると読み取りを止めます" : "上限では止めません"}
              </p>
            </div>

            <UsageBar
              label="回数"
              current={usage.requestCount}
              limit={settings.monthlyRequestLimit}
              format={(value) => `${value} 回`}
            />
            <UsageBar
              label="概算の金額"
              current={usage.costYen}
              limit={settings.monthlyCostLimitYen}
              format={(value) => `¥${Math.round(value).toLocaleString("ja-JP")}`}
            />
            <p className="text-muted-foreground text-xs">
              いま選んでいるモデルは <b className="text-foreground">{model}</b>。
              写真2枚で1回あたり約 ¥{estimateBatchCostYen(2, model).toFixed(0)} です。
            </p>
          </section>

          <section className="flex flex-col gap-3 rounded-xl border px-4 py-4">
            <h2 className="text-sm font-semibold">モデルへ送る範囲</h2>
            <div className="flex flex-wrap gap-2">
              <Chip>画像のみ</Chip>
              <Chip>商品名の一覧を送る: {settings.sendProductNames ? "オン" : "オフ"}</Chip>
              <Chip>
                画像の保存: {settings.imageRetentionDays === 0 ? "しない" : `${settings.imageRetentionDays}日`}
              </Chip>
            </div>
            <p className="text-muted-foreground text-xs">
              在庫の数量・期限・保管場所・家族の情報は送りません。いま保存されている画像は
              <b className="text-foreground"> {overview.storedImages.count}枚</b>（
              {formatBytes(overview.storedImages.bytes)}）です。
            </p>
            <Button asChild variant="outline" size="sm" className="self-start">
              <Link href="/intake/settings">設定を変える</Link>
            </Button>
          </section>
        </div>

        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold">最近の取り込み</h2>
          {batches.length === 0 ? (
            <p className="text-muted-foreground rounded-xl border border-dashed px-4 py-6 text-center text-sm">
              まだ取り込みはありません。レシートや買ってきた品物を撮って試してみてください。
            </p>
          ) : (
            <ul className="divide-y rounded-xl border">
              {batches.map((batch) => (
                <BatchRow key={batch.id} batch={batch} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

function BatchRow({ batch }: { batch: IntakeBatchRow }) {
  const pending = batch.candidates.filter((candidate) => candidate.status === "PENDING").length;
  const applied = batch.candidates.filter((candidate) => candidate.status === "APPLIED").length;
  const kinds = batch.images.map((image) => INTAKE_IMAGE_KIND_LABELS[image.kind as IntakeImageKind]);
  const purged = batch.images.length > 0 && batch.images.every((image) => image.purgedAt !== null);

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <span className="text-muted-foreground w-20 shrink-0 text-xs tabular-nums">
        {formatTokyoDateTime(batch.createdAt)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          {summarizeKinds(kinds)} {batch.images.length}枚
        </p>
        <p className="text-muted-foreground text-xs">
          {batch.status === "FAILED"
            ? (batch.error ?? "読み取りに失敗しました。")
            : batch.status === "DISCARDED"
              ? "破棄しました"
              : `候補 ${batch.candidates.length}件（確認待ち ${pending}件・登録済み ${applied}件）`}
          {purged && batch.status !== "FAILED" ? "・画像は削除済み" : ""}
        </p>
      </div>
      <StatusChip status={batch.status} pending={pending} />
      {batch.status === "FAILED" ? (
        <Button asChild variant="ghost" size="sm">
          <Link href="/inventory/new">
            <Pencil className="size-3.5" aria-hidden />
            手入力
          </Link>
        </Button>
      ) : batch.status === "DISCARDED" ? null : (
        <Button asChild variant="ghost" size="sm">
          <Link href={`/intake/${batch.id}`}>開く</Link>
        </Button>
      )}
    </li>
  );
}

function StatusChip({ status, pending }: { status: string; pending: number }) {
  if (status === "FAILED") {
    return (
      <span className="border-destructive text-destructive rounded-full border px-2 py-px text-[11px] font-semibold">
        失敗
      </span>
    );
  }
  if (status === "EXTRACTING") {
    return <Chip>読み取り中</Chip>;
  }
  if (status === "DISCARDED") {
    return <Chip>破棄</Chip>;
  }
  if (pending > 0) {
    return (
      <span className="ring-foreground rounded-full px-2 py-px text-[11px] font-semibold ring-1">
        確認待ち {pending}件
      </span>
    );
  }
  return <Chip>反映済み</Chip>;
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="bg-muted text-muted-foreground rounded-full px-2 py-px text-[11px] leading-4">
      {children}
    </span>
  );
}

/**
 * 使用量のバー。**割合を色だけで表さない**（数値と「上限なし」の語を必ず併記する）。
 */
function UsageBar({
  label,
  current,
  limit,
  format,
}: {
  label: string;
  current: number;
  limit: number;
  format: (value: number) => string;
}) {
  const ratio = limit > 0 ? Math.min(1, current / limit) : 0;

  return (
    <div className="grid grid-cols-[6rem_1fr_auto] items-center gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="bg-muted h-1.5 overflow-hidden rounded-full">
        <span className="bg-foreground block h-full" style={{ width: `${ratio * 100}%` }} />
      </span>
      <span className="tabular-nums">
        {format(current)} / {limit > 0 ? format(limit) : "上限なし"}
      </span>
    </div>
  );
}

/** 「レシート2枚・購入品1枚」ではなく「レシート・購入品」と短くまとめる。 */
function summarizeKinds(kinds: readonly string[]): string {
  return [...new Set(kinds)].join("・") || "写真";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
