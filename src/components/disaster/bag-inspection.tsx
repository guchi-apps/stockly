import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CircleHelp,
  MinusCircle,
  PackageOpen,
  type LucideIcon,
} from "lucide-react";
import { cn } from "cn";

import { CoverageBar, ratioPercent } from "@/components/disaster/coverage-summary";
import type { DisasterAssessment } from "@/lib/disaster/assess";
import { EXCLUSION_REASON_LABELS, EXCLUSION_REASON_NOTES } from "@/lib/disaster/assess";
import {
  INSPECTION_STATUS_LABELS,
  type BagAttentionGroup,
  type BagAttentionKind,
  type DisasterBagPlanValue,
  type InspectionState,
} from "@/lib/disaster/bag";
import type { DisasterBagContentItem, DisasterBagSummary } from "@/lib/disaster/bag-queries";
import { categoryRule, formatDisasterAmount } from "@/lib/disaster/rules";
import { EXPIRY_STATUS_LABELS } from "@/lib/inventory/operations";
import { formatQuantity, UNIT_DEFINITIONS } from "@/lib/inventory/units";
import { formatTokyoDate } from "@/lib/time/tokyo";

/**
 * 防災バッグの点検の見せ方（#8）。
 *
 * **状態は必ず「記号 + 語 + 数」で出す**（受入条件の「色だけに依存せず不足を表現する」）。
 * 色は補助で、白黒で印刷しても・色を見分けられなくても同じことが読める形にしてある。
 *
 * 判定の数字はすべて`assess.ts`の出力をそのまま並べるだけで、ここでは計算しない。
 */

/** 点検の状態ごとの見え方。`OK`だけは色を持たせず、目立たせない。 */
const INSPECTION_TONE: Readonly<
  Record<InspectionState["status"], { icon: LucideIcon; className: string }>
> = {
  NEVER: {
    icon: CircleHelp,
    className:
      "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  },
  OVERDUE: {
    icon: AlertTriangle,
    className:
      "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
  },
  DUE_SOON: {
    icon: CalendarClock,
    className:
      "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  },
  OK: { icon: CheckCircle2, className: "text-muted-foreground" },
};

export function InspectionBadge({ state }: { state: InspectionState }) {
  const { icon: Icon, className } = INSPECTION_TONE[state.status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {INSPECTION_STATUS_LABELS[state.status]}
    </span>
  );
}

/** 「次にいつ点検するか」の一文。日付だけでなく、あと何日かも出す。 */
export function inspectionSentence(state: InspectionState, plan: DisasterBagPlanValue): string {
  if (state.status === "NEVER") {
    return `点検の記録がまだありません（${plan.inspectionIntervalDays}日ごとに点検する設定です）`;
  }
  const last = state.lastInspectedOn ? formatTokyoDate(state.lastInspectedOn) : "—";
  const due = state.dueOn ? formatTokyoDate(state.dueOn) : "—";
  const left =
    state.daysLeft === null
      ? ""
      : state.daysLeft < 0
        ? `・${Math.abs(state.daysLeft)}日過ぎています`
        : state.daysLeft === 0
          ? "・今日です"
          : `・あと${state.daysLeft}日`;
  return `最終点検 ${last} ・ 次回 ${due}${left}（${plan.inspectionIntervalDays}日ごと）`;
}

/** 点検の期限を知らせる帯。バッグの画面と防災ストックの画面で同じ見た目を使う。 */
export function InspectionBanner({
  state,
  plan,
  children,
}: {
  state: InspectionState;
  plan: DisasterBagPlanValue;
  children?: React.ReactNode;
}) {
  const { icon: Icon, className } = INSPECTION_TONE[state.status];

  return (
    <div
      className={cn(
        "mx-4 mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3.5 py-3 md:mx-6",
        state.status === "OK" ? "" : className,
      )}
    >
      <Icon className="size-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <b className="text-sm">{INSPECTION_STATUS_LABELS[state.status]}</b>
        <p className="text-xs opacity-90">{inspectionSentence(state, plan)}</p>
      </div>
      {children}
    </div>
  );
}

const ATTENTION_ICONS: Readonly<Record<BagAttentionKind, LucideIcon>> = {
  EXPIRED: AlertTriangle,
  EXPIRING_SOON: CalendarClock,
  UNKNOWN_EXPIRY: CircleHelp,
  OPENED: PackageOpen,
  NOT_POSITIVE: MinusCircle,
};

/**
 * 手当てが要るものの件数。
 *
 * **0件の観点も並べる。** 消してしまうと「見ていない」のか「0件だった」のかが読み分けられず、
 * 点検表としての意味が無くなる。
 */
export function AttentionGrid({ groups }: { groups: readonly BagAttentionGroup[] }) {
  return (
    <ul className="grid grid-cols-2 gap-2 px-4 py-4 md:grid-cols-5 md:px-6">
      {groups.map((group) => {
        const Icon = ATTENTION_ICONS[group.kind];
        const hit = group.items.length > 0;
        return (
          <li
            key={group.kind}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-2.5 py-2",
              hit
                ? "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40"
                : "",
            )}
          >
            <Icon
              className={cn("size-4 shrink-0", hit ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}
              aria-hidden
            />
            <span
              className={cn(
                "text-lg leading-none font-bold tabular-nums",
                hit ? "text-amber-800 dark:text-amber-200" : "",
              )}
            >
              {group.items.length}
            </span>
            <span className="min-w-0 text-[11px] leading-tight">
              {group.label}
              <span className="text-muted-foreground block text-[10px]">{group.note}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * バッグの中身1行。
 *
 * **実量と、判定単位へ換算した量の両方を出す**（受入条件の「使用回数」を点検できるように、
 * 「3枚 → 3回ぶん」が見える形にする）。数えなかったものは理由を添え、商品名から
 * 在庫の詳細へ移動できる（受入条件の「算入・除外の理由と対象ロットへ遷移できる」）。
 */
export function BagContentRow({ item }: { item: DisasterBagContentItem }) {
  const raw = formatQuantity({ amount: item.amount, unit: item.unit });
  const rule = item.category ? categoryRule(item.category) : null;
  const counted =
    rule && item.verdict?.countedAmount
      ? formatDisasterAmount(item.verdict.countedAmount, rule.unit)
      : null;
  const exclusion = item.verdict?.exclusion ?? null;

  const detail = !item.category
    ? "非常時の役割が設定されていないため、集計の対象外です"
    : exclusion
      ? `${EXCLUSION_REASON_LABELS[exclusion]} ・ ${EXCLUSION_REASON_NOTES[exclusion]}`
      : `${rule?.label}として算入 ・ ${EXPIRY_STATUS_LABELS[item.expiry.status]}`;

  return (
    <li className="flex items-baseline gap-2.5 px-4 py-2 text-xs md:px-6">
      <Link
        href={`/inventory/${item.lotId}`}
        className="shrink-0 font-semibold underline-offset-2 hover:underline"
      >
        {item.productName}
      </Link>
      <span className="shrink-0 tabular-nums">
        {raw}
        {counted && counted !== raw ? (
          <span className="text-muted-foreground"> → {counted}</span>
        ) : null}
      </span>
      <span className="text-muted-foreground min-w-0 flex-1 truncate">{detail}</span>
      <span
        className={cn(
          "ml-auto shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
          !item.category
            ? "text-muted-foreground"
            : exclusion
              ? "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
              : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
        )}
      >
        {!item.category ? "対象外" : exclusion ? "除外" : "算入"}
      </span>
    </li>
  );
}

/**
 * このバッグに足りていないもの。
 *
 * 区分カードと同じ数字を、**足りないものだけ**に絞って並べる。点検中に「何を足せばよいか」
 * だけを見たい場面のためのもので、新しい判定は行わない。
 */
export function ShortageList({ assessment }: { assessment: DisasterAssessment }) {
  const shortages = assessment.categories.filter((category) => !category.isMet);

  if (shortages.length === 0) {
    return (
      <p className="px-4 py-4 text-xs font-semibold text-emerald-700 md:px-6 dark:text-emerald-400">
        目標に届いていない区分はありません。
      </p>
    );
  }

  return (
    <ul className="flex flex-wrap gap-2 px-4 py-4 md:px-6">
      {shortages.map((category) => (
        <li
          key={category.rule.key}
          className="flex items-baseline gap-2 rounded-lg border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          <b className="tabular-nums">
            {category.rule.label} {formatDisasterAmount(category.shortageAmount, category.rule.unit)}
          </b>
          <span className="text-[10px] opacity-90">
            {category.includedAmount.toDecimalPlaces(3).toString()}
            {UNIT_DEFINITIONS[category.rule.unit].label} /{" "}
            {formatDisasterAmount(category.requiredAmount, category.rule.unit)}（
            {ratioPercent(category)}%）
          </span>
        </li>
      ))}
    </ul>
  );
}

/** 一覧に出すバッグ1件ぶんのカード。 */
export function BagCard({ bag }: { bag: DisasterBagSummary }) {
  const hits = bag.attention.filter((group) => group.items.length > 0);

  return (
    <li className="overflow-hidden rounded-xl border">
      <div className="flex items-center gap-2 px-3.5 py-2.5">
        <Link
          href={`/disaster/bags/${bag.storageLocationId}`}
          className="min-w-0 truncate text-sm font-semibold underline-offset-2 hover:underline"
        >
          {bag.name}
        </Link>
        <span className="ml-auto">
          <InspectionBadge state={bag.inspection} />
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5 px-3.5 pb-2.5 text-[11px]">
        <span className="text-muted-foreground rounded-full border px-2 py-0.5 font-semibold tabular-nums">
          中身 {bag.itemCount}件
        </span>
        {hits.map((group) => (
          <span
            key={group.kind}
            className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 font-semibold tabular-nums text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          >
            {group.label} {group.items.length}
          </span>
        ))}
        {bag.shortageCategoryCount > 0 ? (
          <span className="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 font-semibold tabular-nums text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            不足 {bag.shortageCategoryCount}区分
          </span>
        ) : (
          <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
            目標を満たしています
          </span>
        )}
        <span className="text-muted-foreground rounded-full border px-2 py-0.5 tabular-nums">
          {bag.plan.peopleCount}人・{bag.plan.targetDays}日ぶんを目標
        </span>
      </div>

      <p className="bg-muted/40 text-muted-foreground flex flex-wrap items-center gap-x-3 border-t px-3.5 py-2 text-[11px]">
        <CalendarClock className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">{inspectionSentence(bag.inspection, bag.plan)}</span>
        <Link
          href={`/disaster/bags/${bag.storageLocationId}`}
          className="text-foreground font-semibold underline-offset-2 hover:underline"
        >
          点検する
        </Link>
      </p>
    </li>
  );
}

/** 充足の帯を、区分の並びで1枚にまとめたもの（バッグの画面用）。 */
export function BagCoverageRow({
  label,
  included,
  required,
  percent,
  isMet,
}: {
  label: string;
  included: string;
  required: string;
  percent: number;
  isMet: boolean;
}) {
  return (
    <li className="flex flex-col gap-1.5 rounded-xl border px-3.5 py-2.5">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold">{label}</span>
        <span
          className={cn(
            "ml-auto rounded-full border px-2 py-0.5 text-[11px] font-semibold",
            isMet
              ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
          )}
        >
          {isMet ? "充足" : "不足"}
        </span>
      </div>
      <p className="flex items-baseline gap-1 text-xs tabular-nums">
        <b className="text-base">{included}</b>
        <span className="text-muted-foreground">/ {required}</span>
        <span className="ml-auto font-bold">{percent}%</span>
      </p>
      <CoverageBar percent={percent} isMet={isMet} />
    </li>
  );
}
