import Link from "next/link";
import { AlertTriangle, Check } from "lucide-react";
import { cn } from "cn";

import {
  confirmConsumptionCandidateAction,
  rejectConsumptionCandidateAction,
} from "@/app/(app)/inventory/consume/actions";
import { ExpiryBadge } from "@/components/inventory/expiry-badge";
import { SubmitButton } from "@/components/inventory/submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { evidenceLines, type ConsumptionScanItemView } from "@/lib/consumption/queries";
import {
  CONFIDENCE_LABELS,
  CONFIDENCE_MARKS,
  SKIP_REASON_LABELS,
  confidenceLevel,
  type ConfidenceLevel,
} from "@/lib/consumption/matching";
import { formatAmount, resolveExpiry } from "@/lib/inventory/operations";
import { newOperationId } from "@/lib/inventory/service";
import { UNIT_DEFINITIONS } from "@/lib/inventory/units";

/**
 * 写真から出した候補の見せ方（#11）。
 *
 * 守っていることは3つ。
 *
 * 1. **確定は1件ずつ、人が押す。** 「すべて減らす」はどこにも置かない。まとめ確定があると、
 *    信頼度の低い候補まで一緒に通ってしまい、受入条件の「AIが自動確定する経路を持たない」が
 *    実質的に崩れる
 * 2. **信頼度を色だけで表さない。** %・「高／中／低」・記号を必ず並べ、バーの足りない部分は
 *    斜線にする（#8の充足率と同じ約束）
 * 3. **減らさなかったものも理由付きで出す。** 件数だけでは「見落とし」と「安全側に倒した」を
 *    読み分けられない
 */

const LEVEL_TEXT: Readonly<Record<ConfidenceLevel, string>> = {
  HIGH: "text-emerald-700 dark:text-emerald-300",
  MEDIUM: "text-amber-700 dark:text-amber-300",
  LOW: "text-rose-700 dark:text-rose-300",
};

const LEVEL_CHIP: Readonly<Record<ConfidenceLevel, string>> = {
  HIGH: "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40",
  MEDIUM: "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40",
  LOW: "border-rose-300 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40",
};

/** 信頼度。**%・語・記号・バーの4つで同じことを言う。** */
function ConfidenceMeter({ confidence }: { confidence: number }) {
  const level = confidenceLevel(confidence);
  const percent = Math.round(confidence * 100);

  return (
    <div className={cn("flex items-center gap-2", LEVEL_TEXT[level])}>
      <span aria-hidden className="font-mono text-xs tracking-widest">
        {CONFIDENCE_MARKS[level]}
      </span>
      <span className="font-mono text-sm font-bold tabular-nums">{percent}%</span>
      <span className={cn("rounded-full border px-2 text-[11px] font-bold", LEVEL_CHIP[level])}>
        信頼度 {CONFIDENCE_LABELS[level]}
      </span>
      <span className="sr-only">（{percent}パーセント）</span>
      <span
        aria-hidden
        className="bg-muted relative hidden h-1.5 w-20 overflow-hidden rounded-full border sm:block"
      >
        <span
          className="absolute inset-y-0 left-0 bg-current"
          style={{ width: `${Math.max(3, percent)}%` }}
        />
        {/* 足りない部分は斜線。色が読めない環境でも「満たしていない」ことが分かる。 */}
        <span
          className="absolute inset-y-0 right-0 bg-[repeating-linear-gradient(135deg,currentColor_0_2px,transparent_2px_5px)] opacity-40"
          style={{ width: `${100 - Math.max(3, percent)}%` }}
        />
      </span>
    </div>
  );
}

export function ConsumeCandidateCard({
  item,
  redirectTo,
}: {
  item: ConsumptionScanItemView;
  redirectTo: string;
}) {
  const lot = item.stockLot;
  if (!lot || !item.unit) return null;

  const unitLabel = UNIT_DEFINITIONS[item.unit].label;
  const proposed = item.proposedAmount ? formatAmount(item.proposedAmount) : "";
  const confidence = item.confidence.toNumber();
  const level = confidenceLevel(confidence);
  const evidence = evidenceLines(item.evidence);
  const remaining = item.proposedAmount ? lot.quantity.sub(item.proposedAmount) : null;

  if (item.status !== "PENDING") {
    return <SettledCard item={item} unitLabel={unitLabel} />;
  }

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border md:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-2.5 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <b className="text-[15px] font-bold">{item.product?.name ?? item.detectedLabel}</b>
          <ExpiryBadge expiry={resolveExpiry(lot, new Date())} />
          {lot.openedAt ? <Badge variant="outline">使用中</Badge> : null}
        </div>

        <p className="text-muted-foreground text-xs">
          対象の在庫{" "}
          <span className="text-foreground font-medium">
            {[lot.storageLocation?.name, lot.storagePosition?.name].filter(Boolean).join(" ／ ") ||
              "場所未設定"}
          </span>
          {" ・ いま "}
          <span className="text-foreground font-medium">
            {formatAmount(lot.quantity)}
            {UNIT_DEFINITIONS[lot.unit].label}
          </span>
        </p>

        <ConfidenceMeter confidence={confidence} />

        <ul className="flex flex-col gap-1">
          {evidence.map((line) => (
            <li key={line} className="text-muted-foreground pl-3.5 -indent-3.5 text-xs leading-relaxed">
              <span aria-hidden className="text-border mr-1">
                ›
              </span>
              {line}
            </li>
          ))}
        </ul>

        {level === "LOW" ? (
          <p className="flex items-start gap-2 rounded-lg border border-dashed border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            信頼度が低い候補です。量を確かめてから減らしてください。
          </p>
        ) : null}
      </div>

      <div className="bg-muted/50 flex shrink-0 flex-col gap-2 border-t px-4 py-3 md:w-56 md:border-t-0 md:border-l">
        <form action={confirmConsumptionCandidateAction} className="flex flex-col gap-2">
          <input type="hidden" name="itemId" value={item.id} />
          <input type="hidden" name="operationId" value={newOperationId()} />
          <input type="hidden" name="redirectTo" value={redirectTo} />

          <label className="text-muted-foreground text-[11px] font-bold" htmlFor={`amount-${item.id}`}>
            減らす量（直せます）
          </label>
          <div className="flex items-center gap-2">
            <Input
              id={`amount-${item.id}`}
              name="amount"
              defaultValue={proposed}
              inputMode="decimal"
              autoComplete="off"
              className="h-10 w-24 text-base font-semibold tabular-nums"
            />
            <span className="text-muted-foreground text-xs">{unitLabel}</span>
            {remaining ? (
              <span className="text-muted-foreground text-[11px]">
                → 残り {formatAmount(remaining)}
              </span>
            ) : null}
          </div>

          <SubmitButton variant="default" className="h-10 w-full" pendingLabel="記録中…">
            減らす
          </SubmitButton>
        </form>

        <form action={rejectConsumptionCandidateAction}>
          <input type="hidden" name="itemId" value={item.id} />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <SubmitButton variant="ghost" className="text-muted-foreground h-8 w-full">
            却下する
          </SubmitButton>
        </form>
      </div>
    </article>
  );
}

/** 確定・却下が済んだ候補。**消さずに残す**——何を減らしたのかがその場で読めなくなるため。 */
function SettledCard({
  item,
  unitLabel,
}: {
  item: ConsumptionScanItemView;
  unitLabel: string;
}) {
  const confirmed = item.status === "CONFIRMED";

  return (
    <article className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-dashed px-4 py-3 text-sm">
      {confirmed ? <Check className="size-4 shrink-0" aria-hidden /> : null}
      <b className="text-foreground font-semibold">
        {item.product?.name ?? item.detectedLabel}
      </b>
      <span className="text-xs">
        {confirmed
          ? `${item.confirmedAmount ? formatAmount(item.confirmedAmount) : ""}${unitLabel} 減らしました`
          : "却下しました（在庫は変わっていません）"}
      </span>
      {confirmed ? (
        <Button asChild variant="ghost" size="sm" className="ml-auto h-8">
          <Link href="/history">履歴で取り消す</Link>
        </Button>
      ) : null}
    </article>
  );
}

/**
 * 減らさなかったもの。
 *
 * **在庫に無い商品をここから減らす導線は置かない**（受入条件「存在しない商品を自動減算しない」）。
 * 進める先は「在庫に登録する」か「在庫から選ぶ」だけにしてある。
 */
export function SkippedObservationList({ items }: { items: readonly ConsumptionScanItemView[] }) {
  if (items.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-xl border">
      <h3 className="bg-muted flex items-baseline gap-2 border-b px-4 py-2.5 text-xs font-bold">
        減らさなかったもの
        <span className="text-muted-foreground font-normal">
          {items.length}件 ・ 自動では減らしません
        </span>
      </h3>
      <ul>
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3 last:border-b-0">
            <div className="min-w-0 flex-1">
              <b className="text-sm font-semibold">{item.detectedLabel}</b>
              <p className="text-muted-foreground text-xs leading-relaxed">
                {item.skipReason ? SKIP_REASON_LABELS[item.skipReason] : ""}
                {evidenceLines(item.evidence)[0] ? ` — ${evidenceLines(item.evidence)[0]}` : ""}
              </p>
            </div>
            <Button asChild variant="outline" size="sm" className="h-9">
              <Link
                href={
                  item.product ? `/inventory?q=${encodeURIComponent(item.product.name)}` : "/inventory/new"
                }
              >
                {item.product ? "在庫から選ぶ" : "在庫に登録する"}
              </Link>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
