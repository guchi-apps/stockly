import Link from "next/link";
import { cn } from "cn";

import { EXPIRY_FILTER_LABELS, type ExpiryFilterKey } from "@/lib/inventory/expiry";
import type { ExpirySummary as ExpirySummaryValue } from "@/lib/inventory/expiry";

/**
 * 期限の件数の内訳。
 *
 * **「要確認」を「期限内」と別に置くことがこの並びの要点。** 4つを合計すると在庫の全件になり、
 * 期限を入れ忘れた在庫が「期限内」に紛れて数えられていないことが、見ただけで分かる。
 * それぞれのタイルは在庫一覧の同じ絞り込みへのリンクにしてあり、件数から中身へ辿れる。
 */
const STYLES: Record<ExpiryFilterKey | "fine", string> = {
  expired:
    "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
  soon: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  unknown:
    "border-dashed border-slate-400 bg-slate-50 text-slate-600 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-300",
  fine: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  all: "",
};

export function ExpirySummary({
  summary,
  soonDaysNote,
}: {
  summary: ExpirySummaryValue;
  soonDaysNote: string;
}) {
  const tiles = [
    {
      key: "expired" as const,
      label: EXPIRY_FILTER_LABELS.expired,
      value: summary.expired,
      note:
        summary.worstOverdueDays === null
          ? "ありません"
          : `いちばん古いもので${summary.worstOverdueDays}日超過`,
      href: "/inventory?expiry=expired",
    },
    {
      key: "soon" as const,
      label: EXPIRY_FILTER_LABELS.soon,
      value: summary.soon,
      note: soonDaysNote,
      href: "/inventory?expiry=soon",
    },
    {
      key: "unknown" as const,
      label: EXPIRY_FILTER_LABELS.unknown,
      value: summary.unknown,
      note: "期限が未入力",
      href: "/inventory?expiry=unknown",
    },
    {
      key: "fine" as const,
      label: "期限内",
      value: summary.fine,
      note: `在庫は全部で${summary.total}件`,
      href: "/inventory",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2.5 px-4 py-4 md:grid-cols-4 md:px-6">
      {tiles.map((tile) => (
        <Link
          key={tile.key}
          href={tile.href}
          className={cn(
            "flex flex-col gap-0.5 rounded-xl border px-3.5 py-3 transition-opacity hover:opacity-80",
            STYLES[tile.key],
          )}
        >
          <span className="text-xs font-semibold">{tile.label}</span>
          <span className="text-2xl leading-tight font-bold tabular-nums">
            {tile.value}
            <span className="ml-0.5 text-xs font-medium">件</span>
          </span>
          <span className="text-[11px] opacity-80">{tile.note}</span>
        </Link>
      ))}
    </div>
  );
}
