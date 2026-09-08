import { Badge } from "@/components/ui/badge";
import { EXPIRY_KIND_LABELS, type ExpiryState } from "@/lib/inventory/operations";
import { formatTokyoDate } from "@/lib/time/tokyo";

/**
 * 期限の状態を示すバッジ。
 *
 * 色はアプリの無彩色のトークンではなく、意味を持つ色（期限切れ＝赤、期限間近＝黄土、
 * 余裕あり＝緑、要確認＝灰の破線）をここ1か所に閉じて使う。同じ判定を画面ごとに書くと、
 * 一覧と詳細で「期限間近」の境目がずれる。
 *
 * **期限が入っていないものは「期限なし」ではなく「要確認」と呼ぶ。** 「なし」と書くと
 * 期限が存在しない商品（乾電池など）と、入れ忘れの見分けが付かず、どちらも放置される。
 * 破線にしてあるのも「まだ確定していない」ことを見た目で分けるため。
 */
const STYLES: Record<ExpiryState["status"], string> = {
  EXPIRED:
    "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300",
  SOON: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300",
  FINE: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300",
  UNKNOWN:
    "border-dashed border-slate-400 bg-slate-50 text-slate-600 dark:border-slate-600 dark:bg-slate-900/50 dark:text-slate-300",
};

export function ExpiryBadge({
  expiry,
  detailed = false,
}: {
  expiry: ExpiryState;
  detailed?: boolean;
}) {
  if (expiry.status === "UNKNOWN" || !expiry.date) {
    return (
      <Badge variant="outline" className={STYLES.UNKNOWN}>
        {detailed ? "要確認 ・ 期限が未入力です" : "要確認"}
      </Badge>
    );
  }

  const date = formatTokyoDate(expiry.date);
  const days = expiry.daysLeft ?? 0;
  const label =
    expiry.status === "EXPIRED"
      ? `期限切れ ${date}`
      : days === 0
        ? `今日まで ${date}`
        : expiry.status === "SOON"
          ? `あと${days}日 ${date}`
          : date;

  return (
    <Badge variant="outline" className={STYLES[expiry.status]}>
      {detailed ? `${EXPIRY_KIND_LABELS[expiry.kind]} ・ ${label}` : label}
      {detailed && expiry.status === "EXPIRED" ? `（${Math.abs(days)}日超過）` : null}
    </Badge>
  );
}
