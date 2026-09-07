import { Badge } from "@/components/ui/badge";
import { EXPIRY_KIND_LABELS, type ExpiryState } from "@/lib/inventory/operations";

/**
 * 期限の状態を示すバッジ。
 *
 * 色はアプリの無彩色のトークンではなく、意味を持つ色（期限切れ＝赤、期限間近＝黄土、
 * 余裕あり＝緑）をここ1か所に閉じて使う。同じ判定を画面ごとに書くと、一覧と詳細で
 * 「期限間近」の境目がずれる。
 */
const STYLES: Record<ExpiryState["status"], string> = {
  EXPIRED:
    "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300",
  SOON: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300",
  FINE: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300",
  NONE: "text-muted-foreground",
};

export function formatDate(date: Date): string {
  return `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function ExpiryBadge({
  expiry,
  detailed = false,
}: {
  expiry: ExpiryState;
  detailed?: boolean;
}) {
  if (expiry.status === "NONE" || !expiry.date) {
    return (
      <Badge variant="outline" className={STYLES.NONE}>
        期限なし
      </Badge>
    );
  }

  const date = formatDate(expiry.date);
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
