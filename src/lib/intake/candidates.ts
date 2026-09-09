/**
 * 候補の状態と確からしさの扱い（#10）。
 *
 * **AIがどれだけ確からしくても自動確定はしない**（README「プロダクト方針」・受入条件）。
 * ここはその約束を1か所に閉じるための純関数で、DBもNext.jsも持ち込まない
 * （`candidates.test.ts`で「自動確定しない」ことそのものを試せるようにするため）。
 */

/** 候補の状態。DBの`IntakeCandidateStatus`と同じ並び。 */
export const INTAKE_CANDIDATE_STATUSES = ["PENDING", "APPLIED", "REJECTED"] as const;
export type IntakeCandidateStatus = (typeof INTAKE_CANDIDATE_STATUSES)[number];

/** 確からしさの段階の境目。画面の表示（記号・語）もこの境目で切り替える。 */
export const CONFIDENCE_THRESHOLDS = { high: 0.85, medium: 0.6 } as const;
export type ConfidenceLevel = "high" | "medium" | "low";

export const CONFIDENCE_LABELS: Readonly<Record<ConfidenceLevel, string>> = {
  high: "高",
  medium: "中",
  low: "低",
};

export function confidenceLevel(value: number): ConfidenceLevel {
  if (value >= CONFIDENCE_THRESHOLDS.high) return "high";
  if (value >= CONFIDENCE_THRESHOLDS.medium) return "medium";
  return "low";
}

/**
 * 抽出したばかりの候補の状態。
 *
 * **確からしさがいくつであっても`APPLIED`にはしない。** 在庫が変わるのは、人が確認して
 * 「反映する」を押したときだけ。閾値で自動確定する余地を作らないよう、確からしさは
 * ここでは一切見ない（引数にも取らない）。
 *
 * モデルが「在庫にしない行」（小計・値引き・レジ袋）と印を付けたものだけ、はじめから
 * 却下として置く。**消さずに残す**のは、誤って却下されたときに戻せるようにするため。
 */
export function initialCandidateStatus(item: { readonly ignore: boolean }): IntakeCandidateStatus {
  return item.ignore ? "REJECTED" : "PENDING";
}

/**
 * 在庫にできる候補か。**商品名と数量が要る**（`parseStockLotForm()`と同じ条件）。
 * 期限は「日付を持つ種別なのに日付が無い」組み合わせだけを弾く。
 *
 * 満たさない候補は画面に「要入力」として出し、**残りの候補の反映は止めない。**
 */
export function isApplicable(candidate: {
  readonly productName: string;
  readonly amount: { greaterThan(value: number): boolean } | null;
  readonly expiryKind: string;
  readonly expiryDate: Date | null;
}): boolean {
  if (candidate.productName.trim() === "") return false;
  if (!candidate.amount || !candidate.amount.greaterThan(0)) return false;
  if (
    (candidate.expiryKind === "BEST_BEFORE" || candidate.expiryKind === "USE_BY") &&
    !candidate.expiryDate
  ) {
    return false;
  }
  return true;
}

/**
 * 人が候補を直したあとの状態。
 *
 * 却下していた候補を直したら確認待ちへ戻す（直したのに却下のままだと反映されない）。
 * **反映済みの候補はここへ来ない**——`service.ts`が先に弾く（在庫を直すのは履歴の取消）。
 */
export function statusAfterEdit(): IntakeCandidateStatus {
  return "PENDING";
}
