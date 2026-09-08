import Link from "next/link";
import { notFound } from "next/navigation";
import { Backpack, LifeBuoy } from "lucide-react";

import {
  recordBagInspectionAction,
  saveBagPlanAction,
} from "@/app/(app)/disaster/bags/actions";
import { BagInspectionForm, BagPlanForm } from "@/components/disaster/bag-forms";
import {
  AttentionGrid,
  BagCoverageRow,
  InspectionBanner,
  BagContentRow,
  ShortageList,
} from "@/components/disaster/bag-inspection";
import { ratioPercent } from "@/components/disaster/coverage-summary";
import { ActionNotice, EmptyState, PageHeader, firstValue } from "@/components/inventory/chrome";
import { Button } from "@/components/ui/button";
import { getDisasterBag } from "@/lib/disaster/bag-queries";
import { formatDisasterAmount } from "@/lib/disaster/rules";
import { requireInventoryContext } from "@/lib/inventory/context";
import { UNIT_DEFINITIONS } from "@/lib/inventory/units";
import { formatTokyoDate, toTokyoDateInput, tokyoToday } from "@/lib/time/tokyo";

/**
 * 防災バッグ1つの点検（#8）。
 *
 * 上から「点検の期限 → 手当てが要る件数 → 区分ごとの充足 → 中身 → 不足品 → 点検を記録」の順。
 * **点検で最初に知りたいのは数字ではなく「手を入れる必要があるか」**なので、
 * 充足の集計より先に期限と件数を出す。
 *
 * 充足の数字は`assess.ts`の出力をそのまま並べるだけで、この画面には判定ルールを持たない
 * （受入条件の「集計値は防災判定エンジンの出力を使用し、UI内に別ルールを重複実装しない」）。
 */
export default async function DisasterBagPage({
  params,
  searchParams,
}: PageProps<"/disaster/bags/[locationId]">) {
  const [{ locationId }, query] = await Promise.all([params, searchParams]);
  const { ctx, householdName } = await requireInventoryContext();

  if (!ctx) {
    return (
      <EmptyState
        icon={<LifeBuoy className="size-8" />}
        title="家庭が見つかりません"
        description="防災バッグの点検は家庭の在庫から出します。ログインし直しても表示されない場合は、管理者に連絡してください。"
      />
    );
  }

  const bag = await getDisasterBag(ctx, locationId);
  if (!bag) notFound();

  const today = tokyoToday();
  const { assessment } = bag;

  return (
    <>
      <PageHeader
        title={bag.name}
        description={`${householdName ? `${householdName} ・ ` : ""}中身${bag.itemCount}件 ・ ${
          bag.plan.peopleCount
        }人・${bag.plan.targetDays}日ぶんを目標 ・ ルール版 ${assessment.ruleVersion}`}
        actions={
          <Button asChild variant="outline">
            <Link href="/disaster/bags">
              <Backpack className="size-4" aria-hidden />
              バッグの一覧
            </Link>
          </Button>
        }
      />

      <ActionNotice notice={firstValue(query.notice)} error={firstValue(query.error)} />

      <InspectionBanner state={bag.inspection} plan={bag.plan}>
        <a href="#record" className="text-xs font-semibold underline underline-offset-2">
          点検を記録する
        </a>
      </InspectionBanner>

      <h2 className="text-muted-foreground bg-muted/40 mt-4 flex items-baseline gap-2 border-y px-4 py-1.5 text-xs font-semibold md:px-6">
        手当てが要るもの
        <span className="font-normal">中身の期限と残量だけで数えています（充足とは別の観点です）</span>
      </h2>
      <AttentionGrid groups={bag.attention} />

      <h2 className="text-muted-foreground bg-muted/40 flex items-baseline gap-2 border-y px-4 py-1.5 text-xs font-semibold md:px-6">
        このバッグだけで数えた充足
        <span className="font-normal">
          判定は防災ストックと同じルール。目標だけこのバッグのものを使います
        </span>
      </h2>
      <p className="text-muted-foreground px-4 pt-3 text-[11px] leading-relaxed md:px-6">
        数えているのはこのバッグの中身だけですが、
        <b className="text-foreground font-semibold">加熱に要る熱源と、戻すのに要る水は家全体の在庫で見ています</b>
        。カセットボンベを食品棚に置いていても、バッグの中のカップ麺は食べられるためです。
        全体の備蓄日数はここには出しません（バッグ1つで何日という数字は、
        家全体の備えとして読み違えやすいため）。
      </p>
      <ul className="grid grid-cols-1 gap-2.5 px-4 py-4 sm:grid-cols-2 md:grid-cols-3 md:px-6">
        {assessment.categories.map((category) => (
          <BagCoverageRow
            key={category.rule.key}
            label={category.rule.label}
            included={`${category.includedAmount.toDecimalPlaces(3).toString()}${
              UNIT_DEFINITIONS[category.rule.unit].label
            }`}
            required={formatDisasterAmount(category.requiredAmount, category.rule.unit)}
            percent={ratioPercent(category)}
            isMet={category.isMet}
          />
        ))}
      </ul>

      <h2 className="text-muted-foreground bg-muted/40 flex items-baseline gap-2 border-y px-4 py-1.5 text-xs font-semibold md:px-6">
        不足品
        <span className="font-normal">
          目標（{bag.plan.peopleCount}人・{bag.plan.targetDays}日ぶん）に届いていないぶん
        </span>
      </h2>
      <ShortageList assessment={assessment} />

      <h2 className="text-muted-foreground bg-muted/40 flex items-baseline gap-2 border-y px-4 py-1.5 text-xs font-semibold md:px-6">
        中身
        <span className="font-normal">
          {bag.itemCount}件 ・ 商品名から在庫の詳細へ移動できます
        </span>
      </h2>
      {bag.contents.length === 0 ? (
        <p className="text-muted-foreground mx-4 my-4 rounded-lg border border-dashed px-3 py-6 text-center text-xs leading-relaxed md:mx-6">
          このバッグに入っている在庫がありません。在庫を登録するときに保管場所を「{bag.name}」に
          すると、ここに並びます。
        </p>
      ) : (
        <ul className="divide-y border-b">
          {bag.contents.map((item) => (
            <BagContentRow key={item.lotId} item={item} />
          ))}
        </ul>
      )}

      <h2
        id="record"
        className="text-muted-foreground bg-muted/40 flex items-baseline gap-2 border-y px-4 py-1.5 text-xs font-semibold md:px-6"
      >
        点検を記録する
        <span className="font-normal">見たことの記録として残します</span>
      </h2>
      <BagInspectionForm
        action={recordBagInspectionAction}
        storageLocationId={bag.storageLocationId}
        today={toTokyoDateInput(today)}
      />

      {bag.inspections.length > 0 ? (
        <ul className="flex flex-col gap-1.5 px-4 pb-4 text-xs md:px-6">
          {bag.inspections.map((inspection) => (
            <li key={inspection.id} className="flex flex-wrap items-baseline gap-x-2.5">
              <b className="tabular-nums">{formatTokyoDate(inspection.inspectedOn)}</b>
              <span className="text-muted-foreground tabular-nums">
                中身{inspection.itemCount}件 ・ 期限切れ{inspection.expiredCount} ・ 期限間近
                {inspection.expiringSoonCount} ・ 要確認{inspection.unknownExpiryCount}
              </span>
              {inspection.note ? (
                <span className="min-w-0 flex-1 truncate">{inspection.note}</span>
              ) : null}
              <span className="text-muted-foreground ml-auto text-[10px]">
                ルール版 {inspection.ruleVersion}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <h2 className="text-muted-foreground bg-muted/40 flex items-baseline gap-2 border-y px-4 py-1.5 text-xs font-semibold md:px-6">
        このバッグの基準
        <span className="font-normal">
          {bag.isDefaultPlan ? "まだ保存していません（既定で判定しています）" : "保存済み"}
        </span>
      </h2>
      <BagPlanForm
        action={saveBagPlanAction}
        storageLocationId={bag.storageLocationId}
        initial={{
          peopleCount: String(bag.plan.peopleCount),
          targetDays: String(bag.plan.targetDays),
          inspectionIntervalDays: String(bag.plan.inspectionIntervalDays),
        }}
        isDefault={bag.isDefaultPlan}
      />

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
