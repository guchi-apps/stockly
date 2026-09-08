import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, MapPin } from "lucide-react";

import { updateIntakeCandidateAction } from "@/app/(app)/intake/actions";
import { ActionNotice, EmptyState, PageHeader, firstValue } from "@/components/inventory/chrome";
import { StockLotForm } from "@/components/inventory/stock-lot-form";
import { Button } from "@/components/ui/button";
import { requireInventoryContext } from "@/lib/inventory/context";
import { getIntakeBatch } from "@/lib/intake/queries";
import { listInventoryFormOptions } from "@/lib/inventory/queries";
import { newOperationId } from "@/lib/inventory/service";
import { toTokyoDateInput } from "@/lib/time/tokyo";
import type { CandidateSources } from "@/lib/barcode/candidate";

/**
 * 候補1件を直す画面（#10）。
 *
 * **在庫の登録フォーム（`StockLotForm`）をそのまま使う。** 同じ内容を入れる画面が2つあると、
 * 片方だけ検証が緩い・単位の選択肢が違う、といったずれが必ず出る。出所のチップも
 * 在庫の登録と同じ見た目で出る。
 */
export default async function IntakeCandidatePage({
  params,
  searchParams,
}: PageProps<"/intake/[batchId]/[candidateId]">) {
  const { batchId, candidateId } = await params;
  const query = await searchParams;
  const { ctx } = await requireInventoryContext();

  if (!ctx) {
    return (
      <EmptyState
        icon={<MapPin className="size-8" />}
        title="家庭が見つかりません"
        description="在庫は家庭に属します。ログインし直しても表示されない場合は、管理者に連絡してください。"
      />
    );
  }

  const [batch, options] = await Promise.all([
    getIntakeBatch(ctx, batchId),
    listInventoryFormOptions(ctx),
  ]);
  const candidate = batch?.candidates.find((row) => row.id === candidateId);
  if (!batch || !candidate) notFound();

  return (
    <>
      <PageHeader
        title="候補を直す"
        description="直した内容はこの候補にだけ効きます。反映するまで在庫は変わりません"
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href={`/intake/${batch.id}`}>
              <ArrowLeft className="size-4" aria-hidden />
              候補の一覧
            </Link>
          </Button>
        }
      />

      <ActionNotice notice={firstValue(query.notice)} error={firstValue(query.error)} />

      <StockLotForm
        action={updateIntakeCandidateAction}
        operationId={newOperationId()}
        locations={options.locations}
        categories={options.categories}
        hidden={{ candidateId: candidate.id, batchId: batch.id }}
        sources={readSources(candidate.fieldSources)}
        initial={{
          productName: candidate.productName,
          categoryName: candidate.categoryName,
          amount: candidate.amount ? candidate.amount.toString() : "",
          unit: candidate.unit,
          storageLocationId: candidate.storageLocationId ?? "",
          storagePositionId: candidate.storagePositionId ?? "",
          expiryKind: candidate.expiryKind,
          expiryDate: candidate.expiryDate ? toTokyoDateInput(candidate.expiryDate) : "",
          opened: candidate.opened,
          note: candidate.note ?? "",
        }}
        submitLabel="この内容にする"
        cancelHref={`/intake/${batch.id}`}
        beforeFields={
          candidate.evidence ? (
            <p className="bg-muted text-muted-foreground rounded-lg border px-3 py-2 text-xs">
              <b className="text-foreground font-semibold">写真から読んだ内容:</b> {candidate.evidence}
            </p>
          ) : null
        }
      />
    </>
  );
}

function readSources(value: unknown): CandidateSources {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value as CandidateSources;
}
