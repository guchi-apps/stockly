/**
 * 期限の通知の中身と、重複判定のキーを組み立てる純関数。
 *
 * **重複を防ぐ考え方**: キーに日付を入れず、「どのロットが、どの状態か」の組み合わせだけから作る。
 * こうすると、
 *
 * - 同じ日に何度実行しても、状況が変わっていなければ同じキーになり、2回目以降は送られない
 * - 新しく期限切れが出た・期限間近だったものが期限切れになった、のように**状況が変わったときだけ**
 *   別のキーになり、もう一度届く
 *
 * 日付を入れると毎日必ず届いてしまい、「変わっていないのに鳴る通知」になる。
 * 逆にロットidだけ（状態抜き）にすると、期限間近から期限切れへ変わっても届かなくなる。
 */
import { createHash } from "node:crypto";

/** 通知の対象。期限内・要確認は通知しないので、状態はこの2つだけ。 */
export interface ExpiryTarget {
  readonly lotId: string;
  readonly productName: string;
  readonly status: "EXPIRED" | "SOON";
  /** 今日を0とした残り日数。過ぎていれば負。 */
  readonly daysLeft: number;
}

export interface ExpiryNotificationDraft {
  readonly dedupeKey: string;
  readonly title: string;
  readonly body: string;
  readonly payload: {
    readonly expired: number;
    readonly soon: number;
    readonly targets: readonly { lotId: string; status: string; daysLeft: number }[];
  };
}

/** 本文に名前を挙げる件数。多すぎると通知そのものが読まれなくなる。 */
const NAMED_LIMIT = 3;

/**
 * 対象の集合から重複判定キーを作る。
 *
 * 並び順や重複した要素で結果が変わらないよう、`lotId:status`を並べ替えてから畳む。
 * 長さは`NotificationDelivery.dedupeKey`（VARCHAR(120)）に収まるよう先頭32文字だけ使う。
 */
export function expiryDedupeKey(targets: readonly ExpiryTarget[]): string {
  const fingerprint = [...new Set(targets.map((t) => `${t.lotId}:${t.status}`))].sort().join("|");
  return `expiry:${createHash("sha256").update(fingerprint).digest("hex").slice(0, 32)}`;
}

/** 「2日超過」「今日まで」「あと3日」。 */
export function describeDaysLeft(target: ExpiryTarget): string {
  if (target.status === "EXPIRED") return `${Math.abs(target.daysLeft)}日超過`;
  return target.daysLeft === 0 ? "今日まで" : `あと${target.daysLeft}日`;
}

/**
 * 期限の通知1件を組み立てる。対象が無ければ`null`（送るものが無いときは通知そのものを作らない）。
 */
export function buildExpiryNotification(
  targets: readonly ExpiryTarget[],
): ExpiryNotificationDraft | null {
  if (targets.length === 0) return null;

  // 期限が早い順。名前を挙げるときも、いちばん困るものから並べる。
  const sorted = [...targets].sort((a, b) => a.daysLeft - b.daysLeft);
  const expired = sorted.filter((t) => t.status === "EXPIRED").length;
  const soon = sorted.length - expired;

  const title =
    expired > 0 && soon > 0
      ? `期限切れ${expired}件・期限間近${soon}件`
      : expired > 0
        ? `期限切れ${expired}件`
        : `期限間近${soon}件`;

  const named = sorted
    .slice(0, NAMED_LIMIT)
    .map((target) => `${target.productName}（${describeDaysLeft(target)}）`)
    .join("、");
  const rest = sorted.length - Math.min(sorted.length, NAMED_LIMIT);
  const body = rest > 0 ? `${named} ほか${rest}件` : named;

  return {
    dedupeKey: expiryDedupeKey(sorted),
    title,
    body,
    payload: {
      expired,
      soon,
      targets: sorted.map((t) => ({ lotId: t.lotId, status: t.status, daysLeft: t.daysLeft })),
    },
  };
}
