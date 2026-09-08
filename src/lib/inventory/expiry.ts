/**
 * 期限の状態から「何件あるか」「先に何を消費すべきか」を組み立てる純関数。
 *
 * ここにはPrismaもNext.jsも持ち込まない（`expiry.test.ts`がDBの無いCIで回るようにするため）。
 * DBを触る読み取りは`queries.ts`、書き込みは`service.ts`が担う。
 *
 * 並べ方の考え方は2つあり、使い分ける。
 *
 * - **一覧（`compareByExpiry`）**: 期限が早い順そのまま（FEFO）。状態でまとめない
 * - **消費候補（`groupConsumptionCandidates`）**: 期限切れ→期限間近→要確認の順にまとめ、
 *   組の中を期限が早い順にする。「まず何から手を付けるか」を示す画面なので、
 *   種別ごとのしきい値の違い（賞味7日・消費3日）で順序が入れ替わらないようにする
 */
import {
  EXPIRY_STATUS_LABELS,
  type ExpiryState,
  type ExpiryStatus,
} from "./operations.ts";

/** 一覧の絞り込みキー。URLのクエリ（`?expiry=`）にそのまま出る。 */
export const EXPIRY_FILTERS = ["all", "expired", "soon", "unknown"] as const;
export type ExpiryFilterKey = (typeof EXPIRY_FILTERS)[number];

export const EXPIRY_FILTER_LABELS: Readonly<Record<ExpiryFilterKey, string>> = {
  all: "すべて",
  expired: EXPIRY_STATUS_LABELS.EXPIRED,
  soon: EXPIRY_STATUS_LABELS.SOON,
  unknown: EXPIRY_STATUS_LABELS.UNKNOWN,
};

/** URLから来た値を絞り込みキーへ正す。知らない値は「すべて」に倒す。 */
export function parseExpiryFilter(raw: string | undefined | null): ExpiryFilterKey {
  const value = (raw ?? "").trim();
  return EXPIRY_FILTERS.find((key) => key === value) ?? "all";
}

export function matchesExpiryFilter(state: ExpiryState, key: ExpiryFilterKey): boolean {
  switch (key) {
    case "expired":
      return state.status === "EXPIRED";
    case "soon":
      return state.status === "SOON";
    case "unknown":
      return state.status === "UNKNOWN";
    case "all":
      return true;
  }
}

export interface ExpirySummary {
  readonly expired: number;
  readonly soon: number;
  readonly fine: number;
  /** 期限が未入力（要確認）。 */
  readonly unknown: number;
  /** 利用者が「期限なし」と決めたもの。要確認にも期限内にも数えない。 */
  readonly none: number;
  readonly total: number;
  /** いちばん過ぎている件の超過日数。期限切れが無ければnull。 */
  readonly worstOverdueDays: number | null;
}

/**
 * 件数の内訳。**「要確認」を`fine`（期限内）へ混ぜない**ことがこの関数の要点。
 * 「期限なし」と決めたものは`none`として、要確認からも期限内からも外す。
 */
export function summarizeExpiry(states: readonly ExpiryState[]): ExpirySummary {
  let expired = 0;
  let soon = 0;
  let fine = 0;
  let unknown = 0;
  let none = 0;
  let worstOverdueDays: number | null = null;

  for (const state of states) {
    switch (state.status) {
      case "EXPIRED": {
        expired += 1;
        const overdue = Math.abs(state.daysLeft ?? 0);
        if (worstOverdueDays === null || overdue > worstOverdueDays) worstOverdueDays = overdue;
        break;
      }
      case "SOON":
        soon += 1;
        break;
      case "FINE":
        fine += 1;
        break;
      case "UNKNOWN":
        unknown += 1;
        break;
      case "NONE":
        none += 1;
        break;
    }
  }

  return { expired, soon, fine, unknown, none, total: states.length, worstOverdueDays };
}

/** 並べ替えに要る最小限の形。ロットの行はこれを満たす。 */
export interface ExpirySortable {
  readonly expiry: ExpiryState;
  readonly product: { readonly name: string };
}

/**
 * 期限が早い順（FEFO）。期限が入っていないものは最後へ置く。
 *
 * 期限不明を最後にするのは「期限内だから後回し」ではなく、日付として比べようがないため。
 * 件数と絞り込みでは`UNKNOWN`を独立して数え、期限内には混ぜない。
 */
export function compareByExpiry(a: ExpirySortable, b: ExpirySortable): number {
  const left = a.expiry.date?.getTime() ?? Number.POSITIVE_INFINITY;
  const right = b.expiry.date?.getTime() ?? Number.POSITIVE_INFINITY;
  if (left !== right) return left - right;
  return a.product.name.localeCompare(b.product.name, "ja");
}

/** 消費候補としてまとめる組。期限内（FINE）は候補に出さない。 */
export const CANDIDATE_GROUPS = ["EXPIRED", "SOON", "UNKNOWN"] as const;
export type CandidateGroupKey = (typeof CANDIDATE_GROUPS)[number];

export interface CandidateGroup<T> {
  readonly key: CandidateGroupKey;
  readonly label: string;
  readonly rows: readonly T[];
  /** 上限で切る前の件数。`rows.length`と違えば、その組は途中までしか出していない。 */
  readonly total: number;
}

/**
 * 先に消費する候補。期限切れ・期限間近・要確認の順に、組ごとに期限が早い順で返す。
 *
 * `limitPerGroup`は組ごとの表示上限。画面を1スクロールに収めるためのもので、
 * 切った件数は組の`total`で分かる（切り捨てを黙って隠すと「これで全部」と読めてしまう）。
 * `includeUnknown`を`false`にすると要確認の組を候補から外す（家庭ごとの設定。件数と
 * 絞り込みからは消えない）。
 */
export function groupConsumptionCandidates<T extends ExpirySortable>(
  rows: readonly T[],
  options: { limitPerGroup?: number; includeUnknown?: boolean } = {},
): { groups: readonly CandidateGroup<T>[]; total: number } {
  const limit = options.limitPerGroup ?? Number.POSITIVE_INFINITY;
  const includeUnknown = options.includeUnknown ?? true;
  const groups: CandidateGroup<T>[] = [];
  let total = 0;

  for (const key of CANDIDATE_GROUPS) {
    if (key === "UNKNOWN" && !includeUnknown) continue;
    const matched = rows
      .filter((row) => row.expiry.status === (key as ExpiryStatus))
      .sort(compareByExpiry);
    total += matched.length;
    if (matched.length === 0) continue;
    groups.push({
      key,
      label: EXPIRY_STATUS_LABELS[key],
      rows: matched.slice(0, limit),
      total: matched.length,
    });
  }

  return { groups, total };
}
