import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin, Pencil } from "lucide-react";

import { applyIntakeAction, discardIntakeAction, toggleIntakeCandidateAction } from "@/app/(app)/intake/actions";
import { CandidateCard } from "@/components/intake/candidate-card";
import { ActionNotice, EmptyState, PageHeader, firstValue } from "@/components/inventory/chrome";
import { Button } from "@/components/ui/button";
import { requireInventoryContext } from "@/lib/inventory/context";
import { INTAKE_IMAGE_KIND_LABELS, type IntakeImageKind } from "@/lib/intake/prompt";
import { getIntakeBatch } from "@/lib/intake/queries";
import { isApplicable } from "@/lib/intake/candidates";
import { formatTokyoDateTime } from "@/lib/time/tokyo";

/**
 * 候補を確認して在庫へ反映する画面（#10）。
 *
 * **反映は下の固定バーからまとめて1回**にしてある。候補ごとに押させると、7件のレシートで
 * 7回の往復になり、途中で止まったときにどこまで入ったかが分からなくなる。
 */
export default async function IntakeBatchPage({ params, searchParams }: PageProps<"/intake/[batchId]">) {
  const { batchId } = await params;
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

  const batch = await getIntakeBatch(ctx, batchId);
  if (!batch) notFound();

  const pending = batch.candidates.filter((candidate) => candidate.status === "PENDING");
  const applicable = pending.filter((candidate) => isApplicable(candidate));
  const rejected = batch.candidates.filter((candidate) => candidate.status === "REJECTED");
  const applied = batch.candidates.filter((candidate) => candidate.status === "APPLIED");
  const needsInput = pending.length - applicable.length;

  return (
    <>
      <PageHeader
        title="候補を確認する"
        description={`写真${batch.images.length}枚から${batch.candidates.length}件 ・ ${formatTokyoDateTime(batch.createdAt)}`}
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href="/intake">
                <ArrowLeft className="size-4" aria-hidden />
                写真から登録
              </Link>
            </Button>
            {batch.status === "DISCARDED" ? null : (
              <form action={discardIntakeAction}>
                <input type="hidden" name="batchId" value={batch.id} />
                <Button type="submit" variant="outline" size="sm">
                  破棄する
                </Button>
              </form>
            )}
          </>
        }
      />

      <ActionNotice notice={firstValue(query.notice)} error={firstValue(query.error)} />

      <div className="flex flex-col gap-4 px-4 py-4 md:px-6">
        <section className="flex flex-col gap-2 rounded-xl border px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Summary label="抽出" count={batch.candidates.length} />
            <Summary label="反映する" count={applicable.length} strong />
            <Summary label="要入力" count={needsInput} alert={needsInput > 0} />
            <Summary label="却下" count={rejected.length} />
            <Summary label="登録済み" count={applied.length} />
            <p className="text-muted-foreground ml-auto text-xs">
              {batch.model} ・ 概算 ¥{Number(batch.estimatedCostYen).toFixed(1)} ・ ルール版{" "}
              {batch.promptVersion}
            </p>
          </div>
          {needsInput > 0 ? (
            <p className="text-muted-foreground text-xs">
              商品名か数量が読めなかった候補が{needsInput}件あります。
              入れるまでこの{needsInput}件は在庫へ登録されません（残りはそのまま登録できます）。
            </p>
          ) : null}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold">取り込んだ写真</h2>
          <ul className="flex flex-wrap gap-3">
            {batch.images.map((image, index) => (
              <li key={image.id} className="w-28 overflow-hidden rounded-xl border">
                {image.purgedAt ? (
                  <p className="text-muted-foreground bg-muted flex h-24 items-center justify-center px-2 text-center text-[11px]">
                    保存期間を過ぎたため削除済み
                  </p>
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element -- 家庭ごとの画像で、共有キャッシュに載せない */
                  <img
                    src={`/intake/images/${image.id}`}
                    alt={`${index + 1}枚目（${INTAKE_IMAGE_KIND_LABELS[image.kind as IntakeImageKind]}）`}
                    className="h-24 w-full object-cover"
                  />
                )}
                <p className="text-muted-foreground border-t px-2 py-1 text-[11px]">
                  {INTAKE_IMAGE_KIND_LABELS[image.kind as IntakeImageKind]}
                </p>
              </li>
            ))}
          </ul>
        </section>

        {batch.status === "FAILED" ? (
          <section className="border-destructive/40 bg-destructive/10 flex flex-col gap-3 rounded-xl border px-4 py-4">
            <p className="text-destructive text-sm font-semibold">
              {batch.error ?? "読み取りに失敗しました。"}
            </p>
            <p className="text-muted-foreground text-xs">
              明るい場所で撮り直すか、手入力で登録してください。取り込んだ写真の記録は残っています。
            </p>
            <Button asChild className="self-start">
              <Link href="/inventory/new">
                <Pencil className="size-4" aria-hidden />
                手入力で登録する
              </Link>
            </Button>
          </section>
        ) : null}

        {batch.candidates.length === 0 && batch.status !== "FAILED" ? (
          <section className="flex flex-col gap-3 rounded-xl border border-dashed px-4 py-6 text-center">
            <p className="text-sm font-semibold">写真から読み取れるものがありませんでした。</p>
            <p className="text-muted-foreground text-xs">
              ピントと明るさを確かめて撮り直すか、手入力で登録してください。
            </p>
            <Button asChild variant="outline" className="self-center">
              <Link href="/inventory/new">手入力で登録する</Link>
            </Button>
          </section>
        ) : null}

        {batch.candidates.map((candidate) => (
          <CandidateCard
            key={candidate.id}
            candidate={candidate}
            batchId={batch.id}
            toggleAction={toggleIntakeCandidateAction}
          />
        ))}
      </div>

      {applicable.length > 0 ? (
        <div className="bg-background sticky bottom-0 mt-auto flex flex-wrap items-center gap-3 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6">
          <form action={applyIntakeAction} className="contents">
            <input type="hidden" name="batchId" value={batch.id} />
            <Button type="submit" className="h-11 min-w-52 flex-1 md:flex-none">
              {applicable.length}件を在庫へ反映する
            </Button>
          </form>
          <p className="text-muted-foreground hidden flex-1 text-xs md:block">
            入出庫の履歴に「購入」として1件ずつ積まれます。取り消しは履歴からできます。
          </p>
          <Button asChild variant="outline" className="h-11">
            <Link href="/inventory/new">
              <Pencil className="size-4" aria-hidden />
              手入力で登録
            </Link>
          </Button>
        </div>
      ) : null}
    </>
  );
}

function Summary({
  label,
  count,
  strong = false,
  alert = false,
}: {
  label: string;
  count: number;
  strong?: boolean;
  alert?: boolean;
}) {
  const style = alert
    ? "border-destructive text-destructive border"
    : strong
      ? "bg-foreground text-background font-semibold"
      : "bg-muted text-muted-foreground";

  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs ${style}`}>
      {label} <span className="tabular-nums">{count}</span>件
    </span>
  );
}
