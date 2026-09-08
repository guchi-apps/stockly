import Link from "next/link";
import { Backpack, LifeBuoy, Settings2 } from "lucide-react";

import { InspectionBanner } from "@/components/disaster/bag-inspection";
import { CategoryCard, CoverageSummary } from "@/components/disaster/coverage-summary";
import { ActionNotice, EmptyState, PageHeader, firstValue } from "@/components/inventory/chrome";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  groupExclusions,
  type DisasterLotVerdict,
} from "@/lib/disaster/assess";
import { getInspectionAlert } from "@/lib/disaster/bag-queries";
import { getDisasterOverview } from "@/lib/disaster/queries";
import {
  DISASTER_RULE_VERSION,
  categoryRule,
  formatDisasterAmount,
  includedColdZones,
} from "@/lib/disaster/rules";
import { requireInventoryContext } from "@/lib/inventory/context";
import { formatQuantity } from "@/lib/inventory/units";
import { formatTokyoDate, tokyoToday } from "@/lib/time/tokyo";

/**
 * 防災ストック（#7）。
 *
 * 日常の在庫から「非常時に何日ぶんあるか」を出す。**結果と同じ画面に判定の根拠を出す**のが
 * この画面の要点で、算入した在庫と数えなかった在庫（理由つき）を必ず並べる。件数だけだと
 * 「無い」のか「安全側に倒して数えていない」のかが読み分けられない。
 */
export default async function DisasterPage({ searchParams }: PageProps<"/disaster">) {
  const params = await searchParams;
  const { ctx, householdName } = await requireInventoryContext();

  if (!ctx) {
    return (
      <EmptyState
        icon={<LifeBuoy className="size-8" />}
        title="家庭が見つかりません"
        description="防災の集計は家庭の在庫から出します。ログインし直しても表示されない場合は、管理者に連絡してください。"
      />
    );
  }

  const [{ assessment, settings }, bagAlert] = await Promise.all([
    getDisasterOverview(ctx),
    getInspectionAlert(ctx),
  ]);
  // 点検が要るバッグは1件ずつ帯にする。**帯を出すのは点検が要るときだけ**で、
  // 全部済んでいる家庭の画面に「点検済み」の行が並び続けないようにする。
  const overdueBag = bagAlert.needsInspection[0] ?? null;
  const included = assessment.categories.flatMap((category) => category.includedLots);
  const exclusionGroups = groupExclusions(assessment.excludedLots);
  const hasTarget = included.length > 0 || assessment.excludedLots.length > 0;
  const coldZones = includedColdZones(settings.plan);

  return (
    <>
      <PageHeader
        title="防災ストック"
        description={`${householdName ? `${householdName} ・ ` : ""}${formatTokyoDate(
          tokyoToday(),
        )}時点 ・ ${
          coldZones.length > 0
            ? `${coldZones.join("・")}を含める設定で数えています`
            : "停電を前提に常温の在庫だけで数えています"
        }`}
        actions={
          <Button asChild variant="outline">
            <Link href="/disaster/settings">
              <Settings2 className="size-4" aria-hidden />
              基準を設定
            </Link>
          </Button>
        }
      />

      <ActionNotice notice={firstValue(params.notice)} error={firstValue(params.error)} />

      {settings.savedRuleVersion !== DISASTER_RULE_VERSION ? (
        <p
          role="status"
          className="mx-4 mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 md:mx-6 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
        >
          基準を保存したときの判定ルールは{settings.savedRuleVersion}
          で、いまは{DISASTER_RULE_VERSION}です。同じ在庫でも数字が変わっている可能性があります。
        </p>
      ) : null}

      <CoverageSummary assessment={assessment} assessedAtLabel={formatTokyoDate(tokyoToday())} />

      <h2 className="text-muted-foreground bg-muted/40 mt-4 flex items-baseline gap-2 border-y px-4 py-1.5 text-xs font-semibold md:px-6">
        区分ごとの充足
        <span className="font-normal">
          算入した在庫 / 目標{assessment.plan.targetDays}日ぶんに必要な量
        </span>
      </h2>

      <ul className="grid grid-cols-2 gap-2.5 px-4 py-4 md:grid-cols-3 md:px-6">
        {assessment.categories.map((category) => (
          <CategoryCard key={category.rule.key} category={category} />
        ))}
      </ul>

      {bagAlert.total > 0 ? (
        overdueBag ? (
          <InspectionBanner state={overdueBag.inspection} plan={overdueBag.plan}>
            <Button asChild variant="outline" size="sm">
              <Link href={`/disaster/bags/${overdueBag.storageLocationId}`}>
                <Backpack className="size-4" aria-hidden />
                {overdueBag.name}を点検
                {bagAlert.needsInspection.length > 1
                  ? `（ほか${bagAlert.needsInspection.length - 1}件）`
                  : ""}
              </Link>
            </Button>
          </InspectionBanner>
        ) : (
          <p className="text-muted-foreground mx-4 mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-3.5 py-2.5 text-xs md:mx-6">
            <Backpack className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              防災バッグ{bagAlert.total}件は、どれも点検の期限内です。
            </span>
            <Link
              href="/disaster/bags"
              className="text-foreground font-semibold underline-offset-2 hover:underline"
            >
              バッグを見る
            </Link>
          </p>
        )
      ) : null}

      {!hasTarget ? (
        <p className="text-muted-foreground mx-4 rounded-lg border border-dashed px-3 py-6 text-center text-xs leading-relaxed md:mx-6">
          防災の集計に使える在庫がまだありません。商品の「非常時の役割」を設定すると、
          その在庫がこの画面で数えられるようになります。
        </p>
      ) : (
        <>
          <h2 className="text-muted-foreground bg-muted/40 flex items-baseline gap-2 border-y px-4 py-1.5 text-xs font-semibold md:px-6">
            判定の根拠
            <span className="font-normal">
              この結果を後から説明できるように、算入した在庫と外した在庫を並べています
            </span>
          </h2>

          <div className="grid gap-4 px-4 py-4 md:grid-cols-2 md:px-6">
            <section className="overflow-hidden rounded-xl border">
              <h3 className="bg-muted flex items-baseline gap-2 border-b px-3 py-2 text-xs font-semibold">
                算入した在庫
                <span className="text-muted-foreground font-normal">{included.length}件</span>
              </h3>
              {included.length === 0 ? (
                <p className="text-muted-foreground px-3 py-4 text-xs">
                  数えられた在庫はありません。下の「数えなかった在庫」に理由が出ています。
                </p>
              ) : (
                <ul className="divide-y">
                  {included.map((verdict) => (
                    <LotRow key={`${verdict.category}-${verdict.lot.lotId}`} verdict={verdict} />
                  ))}
                </ul>
              )}
            </section>

            <section className="overflow-hidden rounded-xl border">
              <h3 className="bg-muted flex items-baseline gap-2 border-b px-3 py-2 text-xs font-semibold">
                数えなかった在庫
                <span className="text-muted-foreground font-normal">
                  {assessment.excludedLots.length}件・理由つき
                </span>
              </h3>
              {exclusionGroups.length === 0 ? (
                <p className="text-muted-foreground px-3 py-4 text-xs">
                  数えなかった在庫はありません。
                </p>
              ) : (
                <ul className="divide-y">
                  {exclusionGroups.flatMap((group) =>
                    group.lots.map((verdict) => (
                      <LotRow
                        key={`${verdict.category}-${verdict.lot.lotId}`}
                        verdict={verdict}
                        reasonLabel={group.label}
                        reasonNote={group.note}
                      />
                    )),
                  )}
                </ul>
              )}
              <p className="text-muted-foreground border-t px-3 py-2.5 text-[11px] leading-relaxed">
                数えなかったものは「無い」ではなく「安全側に倒して数えていない」です。
                期限や開封状態を入れ直すと、次の判定から算入されます。
              </p>
            </section>
          </div>
        </>
      )}

      <p className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pb-6 text-[11px] md:px-6">
        <span>
          判定は決定的で、同じ在庫・同じ基準・同じルール版なら必ず同じ結果になります（生成AIは使いません）。
        </span>
        <span>
          ルール版 <code>{assessment.ruleVersion}</code>
        </span>
      </p>
    </>
  );
}

/**
 * 根拠1行。**在庫の実量と、判定単位へ換算した量の両方を出す。**
 * 「5本」が「10L」として数えられたことが見えないと、合計を追えない。
 */
function LotRow({
  verdict,
  reasonLabel,
  reasonNote,
}: {
  verdict: DisasterLotVerdict;
  reasonLabel?: string;
  reasonNote?: string;
}) {
  const { lot, countedAmount } = verdict;
  const rule = categoryRule(verdict.category);
  const raw = formatQuantity({ amount: lot.amount, unit: lot.unit });
  const counted = countedAmount ? formatDisasterAmount(countedAmount, rule.unit) : null;

  return (
    <li className="flex items-baseline gap-2.5 px-3 py-2 text-xs">
      <Link
        href={`/inventory/${lot.lotId}`}
        className="shrink-0 font-semibold underline-offset-2 hover:underline"
      >
        {lot.productName}
      </Link>
      <span className="text-muted-foreground min-w-0 flex-1 truncate">
        {reasonLabel ? (
          <>
            <Badge variant="outline" className="mr-1.5 text-[10px]">
              {reasonLabel}
            </Badge>
            {reasonNote}
          </>
        ) : (
          `${raw}${counted && counted !== raw ? ` → ${counted}` : ""} ・ ${rule.label}`
        )}
      </span>
      <span
        className={
          reasonLabel
            ? "text-muted-foreground shrink-0 tabular-nums line-through"
            : "shrink-0 font-semibold tabular-nums"
        }
      >
        {reasonLabel ? raw : (counted ?? raw)}
      </span>
    </li>
  );
}
