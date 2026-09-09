import Link from "next/link";
import { Pencil, RotateCcw, Undo2 } from "lucide-react";

import { ConfidenceMeter, Unreadable } from "@/components/intake/confidence";
import { SourceChip } from "@/components/inventory/source-chip";
import { Button } from "@/components/ui/button";
import type { CandidateSource, CandidateSources } from "@/lib/barcode/candidate";
import type { IntakeCandidateRow } from "@/lib/intake/queries";
import { EXPIRY_KIND_LABELS, type ExpiryKind } from "@/lib/inventory/operations";
import { UNIT_DEFINITIONS } from "@/lib/inventory/units";
import { formatTokyoDate } from "@/lib/time/tokyo";

/**
 * 写真から作った候補1件（#10）。
 *
 * **欄ごとに「値・出所・確からしさ」を並べる。** どこから来た値かが分からないまま埋まっていると、
 * そのままでよいのか直すべきなのかを判断できない（#9の在庫登録フォームと同じ考え方）。
 *
 * **読めなかった欄は空欄のまま出す。** 「未設定」で埋めると、読めなかったことが伝わらない。
 */
export function CandidateCard({
  candidate,
  batchId,
  toggleAction,
}: {
  candidate: IntakeCandidateRow;
  batchId: string;
  toggleAction: (formData: FormData) => void | Promise<void>;
}) {
  const rejected = candidate.status === "REJECTED";
  const applied = candidate.status === "APPLIED";
  const sources = readSources(candidate.fieldSources);

  return (
    <article className={`overflow-hidden rounded-xl border ${rejected ? "opacity-60" : ""}`}>
      <header className="flex items-start gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 className={`text-base font-semibold ${rejected ? "line-through" : ""}`}>
            {candidate.productName ? (
              candidate.productName
            ) : (
              <Unreadable what="商品名" />
            )}
          </h3>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {candidate.brand ? `${candidate.brand} ・ ` : ""}
            {applied
              ? "在庫へ登録済み"
              : rejected
                ? "却下しました（在庫にしないもの）"
                : "確認待ち"}
          </p>
        </div>
        <ConfidenceMeter value={toNumber(candidate.confidence)} />
      </header>

      <dl className="border-t">
        <Field
          label="数量"
          confidence={toNumber(candidate.amountConfidence)}
          source={sources.unit}
        >
          {candidate.amount ? (
            <>
              <b className="tabular-nums">{formatAmount(candidate.amount)}</b>{" "}
              {UNIT_DEFINITIONS[candidate.unit].label}
            </>
          ) : (
            <Unreadable what="数量" />
          )}
        </Field>

        <Field
          label="期限"
          confidence={toNumber(candidate.expiryConfidence)}
          source={sources.expiryDate ?? sources.expiryKind}
        >
          {candidate.expiryDate ? (
            <>
              <b className="tabular-nums">{formatTokyoDate(candidate.expiryDate)}</b>{" "}
              <span className="text-muted-foreground text-xs">
                （{EXPIRY_KIND_LABELS[candidate.expiryKind as ExpiryKind]}）
              </span>
            </>
          ) : candidate.expiryKind === "NONE" ? (
            <span className="text-muted-foreground">期限なし</span>
          ) : (
            <Unreadable what="期限" />
          )}
        </Field>

        <Field
          label="保管場所"
          confidence={toNumber(candidate.storageConfidence)}
          source={sources.storageLocationId}
        >
          {candidate.storageLocation ? (
            <>
              {candidate.storageLocation.name}
              {candidate.storagePosition ? (
                <span className="text-muted-foreground text-xs"> / {candidate.storagePosition.name}</span>
              ) : null}
            </>
          ) : (
            <span className="text-muted-foreground">未設定</span>
          )}
        </Field>

        <Field
          label="カテゴリ"
          confidence={toNumber(candidate.categoryConfidence)}
          source={sources.categoryName}
        >
          {candidate.categoryName ? (
            candidate.categoryName
          ) : (
            <span className="text-muted-foreground">未設定</span>
          )}
        </Field>
      </dl>

      {candidate.evidence ? (
        <p className="bg-muted text-muted-foreground border-t px-4 py-2.5 text-xs">
          <b className="text-foreground font-semibold">根拠:</b> {candidate.evidence}
        </p>
      ) : null}

      <footer className="flex flex-wrap gap-2 border-t px-4 py-2.5">
        {applied ? (
          candidate.appliedStockLotId ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/inventory/${candidate.appliedStockLotId}`}>登録した在庫を見る</Link>
            </Button>
          ) : null
        ) : (
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={`/intake/${batchId}/${candidate.id}`}>
                <Pencil className="size-3.5" aria-hidden />
                直す
              </Link>
            </Button>
            <form action={toggleAction}>
              <input type="hidden" name="candidateId" value={candidate.id} />
              <input type="hidden" name="batchId" value={batchId} />
              <input type="hidden" name="rejected" value={rejected ? "false" : "true"} />
              <Button type="submit" variant="ghost" size="sm">
                {rejected ? (
                  <>
                    <Undo2 className="size-3.5" aria-hidden />
                    却下を取り消す
                  </>
                ) : (
                  <>
                    <RotateCcw className="size-3.5" aria-hidden />
                    却下する
                  </>
                )}
              </Button>
            </form>
          </>
        )}
      </footer>
    </article>
  );
}

function Field({
  label,
  confidence,
  source,
  children,
}: {
  label: string;
  confidence: number | null;
  source?: CandidateSource;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[5rem_1fr] items-center gap-x-3 gap-y-1 border-t px-4 py-2 first:border-t-0 sm:grid-cols-[5rem_1fr_auto]">
      <dt className="text-muted-foreground text-xs font-semibold">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
        {children}
        {source ? <SourceChip source={source} /> : null}
      </dd>
      <div className="col-span-2 sm:col-span-1 sm:justify-self-end">
        <ConfidenceMeter value={confidence} />
      </div>
    </div>
  );
}

/**
 * 保存してある出所（Json）を読む。
 *
 * **DBのJsonはいつでも壊れうる前提で扱う。** ここは表示だけに使うメタデータなので、
 * 読めなければ「出所なし」として静かに落とす（チップが出ないだけで、値は出る）。
 */
function readSources(value: unknown): CandidateSources {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value as CandidateSources;
}

function toNumber(value: { toNumber(): number } | null): number | null {
  return value === null ? null : value.toNumber();
}

/** `1.000`ではなく`1`と出す。末尾の0は読み取りの邪魔にしかならない。 */
function formatAmount(value: { toString(): string }): string {
  const text = value.toString();
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}
