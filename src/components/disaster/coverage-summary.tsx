import { Decimal, UNIT_DEFINITIONS } from "@/lib/inventory/units";
import {
  formatCoverageDays,
  formatDisasterAmount,
  includedColdZones,
  type DisasterPlanValue,
} from "@/lib/disaster/rules";
import type { DisasterAssessment, DisasterCategoryResult } from "@/lib/disaster/assess";
import { cn } from "cn";

/**
 * 防災の集計の見せ方（#7）。
 *
 * **全体の日数は「いちばん短い区分」で出す。** 平均にすると、水だけ足りている家庭が
 * 「2日ぶんある」と読めてしまう。判定の前提（人数・目標日数・1人1日あたりの量・ルール版）を
 * 同じ枠の中に置いて、数字だけが独り歩きしないようにする。
 */
export function CoverageSummary({
  assessment,
  assessedAtLabel,
}: {
  assessment: DisasterAssessment;
  assessedAtLabel: string;
}) {
  const { plan, coverageDays } = assessment;
  const met = coverageDays !== null && coverageDays.greaterThanOrEqualTo(plan.targetDays);
  const shortest = shortestCategories(assessment);

  return (
    <div
      className={cn(
        "mx-4 mt-4 flex flex-col gap-4 rounded-xl border px-4 py-4 md:mx-6 md:flex-row md:items-stretch md:gap-5",
        met
          ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30"
          : "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30",
      )}
    >
      <p
        className={cn(
          "flex items-baseline gap-1.5",
          met
            ? "text-emerald-800 dark:text-emerald-300"
            : "text-red-800 dark:text-red-300",
        )}
      >
        <span className="text-4xl leading-none font-bold tabular-nums">
          {coverageDays === null ? "—" : coverageDays.toDecimalPlaces(1, Decimal.ROUND_DOWN).toString()}
        </span>
        <span className="text-sm font-bold">日ぶん</span>
      </p>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <b
          className={cn(
            "text-sm",
            met ? "text-emerald-900 dark:text-emerald-200" : "text-red-900 dark:text-red-200",
          )}
        >
          {met
            ? `目標の${plan.targetDays}日に届いています。`
            : `目標の${plan.targetDays}日に届いていません。${
                shortest.length > 0 ? `いちばん短いのは${shortest.join("と")}です。` : ""
              }`}
        </b>
        <p className="text-xs">
          いちばん短い区分がそのまま全体の日数になります（照明・電源は日数で数えない区分のため、
          この数字には入りません）。
        </p>
        <p className="text-muted-foreground text-xs">{coldStorageNote(plan)}</p>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 self-center border-t pt-3 text-xs sm:grid-cols-3 md:border-t-0 md:border-l md:pt-0 md:pl-5">
        <Assumption label="人数" value={`${plan.peopleCount}人`} />
        <Assumption label="目標" value={`${plan.targetDays}日`} />
        <Assumption
          label="水"
          value={`${plan.waterLitersPerPersonDay.toString()}L / 人日`}
        />
        <Assumption
          label="食事"
          value={`${plan.foodServingsPerPersonDay.toString()}食 / 人日`}
        />
        <Assumption
          label="携帯トイレ"
          value={`${plan.sanitationUsesPerPersonDay.toString()}回 / 人日`}
        />
        <Assumption label="ルール版" value={assessment.ruleVersion} />
      </dl>

      <p className="sr-only">{assessedAtLabel}時点の判定です。</p>
    </div>
  );
}

/** 冷蔵・冷凍をどう扱っているかの一文。 */
function coldStorageNote(plan: DisasterPlanValue): string {
  const included = includedColdZones(plan);
  if (included.length === 0) {
    return "冷蔵・冷凍の在庫は停電で使えなくなる前提で数えていません。設定で明示的に含めることもできます。";
  }
  return `設定により、${included.join("・")}の在庫も数えています。停電すると使えなくなるため、日数は実際より長く出ます。`;
}

function Assumption({ label, value }: { label: string; value: string }) {
  return (
    <span className="contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </span>
  );
}

/** 全体の日数を決めている区分の名前。「なぜこの日数なのか」を1行で示すために使う。 */
function shortestCategories(assessment: DisasterAssessment): string[] {
  const { coverageDays } = assessment;
  if (coverageDays === null) return [];
  return assessment.categories
    .filter((category) => category.coverageDays?.equals(coverageDays))
    .map((category) => category.rule.label);
}

/** 区分1つぶんのカード。算入量・必要量・不足量・備蓄日数を1か所に置く。 */
export function CategoryCard({ category }: { category: DisasterCategoryResult }) {
  const { rule } = category;
  const ratio = ratioPercent(category);

  return (
    <li
      className={cn(
        "flex flex-col gap-1.5 rounded-xl border px-3.5 py-3",
        category.isMet
          ? "border-emerald-300 dark:border-emerald-900"
          : "border-red-300 dark:border-red-900",
      )}
    >
      <div className="flex items-baseline gap-1.5">
        <span className="text-sm font-semibold">{rule.label}</span>
        <span className="text-muted-foreground hidden text-[10px] sm:inline">{rule.note}</span>
        <span
          className={cn(
            "ml-auto rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums",
            category.coverageDays === null
              ? "text-muted-foreground"
              : category.isMet
                ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
                : "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
          )}
        >
          {category.coverageDays === null ? "日数では数えない" : formatCoverageDays(category.coverageDays)}
        </span>
      </div>

      <p className="flex items-baseline gap-1 tabular-nums">
        <span className="text-xl leading-tight font-bold">
          {category.includedAmount.toDecimalPlaces(3).toString()}
        </span>
        <span className="text-xs font-semibold">
          {UNIT_DEFINITIONS[category.rule.unit].label}
        </span>
        <span className="text-muted-foreground text-xs">
          / {formatDisasterAmount(category.requiredAmount, rule.unit)}
        </span>
      </p>

      <div className="bg-muted h-1.5 overflow-hidden rounded-full" aria-hidden>
        <span
          className={cn(
            "block h-full rounded-full",
            category.isMet ? "bg-emerald-600" : "bg-red-500/80",
          )}
          style={{ width: `${ratio}%` }}
        />
      </div>

      <p className="flex items-baseline gap-2 text-[11px]">
        <span
          className={cn(
            "font-semibold tabular-nums",
            category.isMet ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400",
          )}
        >
          {category.isMet
            ? "目標に届いています"
            : `${formatDisasterAmount(category.shortageAmount, rule.unit)}たりない`}
        </span>
        {category.excludedLots.length > 0 ? (
          <span className="text-muted-foreground ml-auto">
            {category.excludedLots.length}件を除外
          </span>
        ) : null}
      </p>
    </li>
  );
}

/** 充足の割合（0〜100）。必要量が0の区分は満たしている扱いで100にする。 */
function ratioPercent(category: DisasterCategoryResult): number {
  if (!category.requiredAmount.greaterThan(0)) return 100;
  const ratio = category.includedAmount.div(category.requiredAmount).mul(100).toNumber();
  return Math.max(0, Math.min(100, Math.round(ratio)));
}

export function planNote(plan: DisasterPlanValue): string {
  return `${plan.peopleCount}人・${plan.targetDays}日ぶんを目標`;
}
