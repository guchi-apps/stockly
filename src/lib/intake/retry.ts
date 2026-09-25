/**
 * 同じ写真を「もう一度読ませてよいか」の判定（#105）。
 *
 * 二重登録の防止（画像の`sha256`・減算側の指紋）は、**読み取りが成功して結果が残っている**
 * ときだけ働けばよい。失敗・中断した取り込みまで「重複」として返すと、その写真は
 * 二度とモデルへ届かない。DBもNext.jsも持ち込まない純関数で、`retry.test.ts`で試せる。
 */
import { createHash } from "node:crypto";

/** 「読み取り中」のまま放置されたとみなすまでの時間。応答待ちの上限より十分長く取る。 */
export const STALE_EXTRACTION_MS = 10 * 60_000;

export interface RetryableBatchState {
  readonly status: "EXTRACTING" | "REVIEWING" | "APPLIED" | "FAILED" | "DISCARDED";
  readonly createdAt: Date;
  /** 在庫へ反映済みの候補があるか。 */
  readonly hasAppliedCandidate: boolean;
}

/**
 * 取り込みが再読み取りの対象か。
 *
 * - `FAILED`: 一時的な失敗（タイムアウト・529・通信断）の後に送り直せなくなる
 * - 一定時間を過ぎた`EXTRACTING`: 応答待ち中のプロセス再起動で永久に残る
 * - `DISCARDED`: 破棄した写真を読ませ直したいことがある。ただし**在庫へ反映した候補があれば
 *   対象にしない**（同じ内容を二重に登録させないため）
 */
export function isRetryableBatch(batch: RetryableBatchState, now: Date): boolean {
  switch (batch.status) {
    case "FAILED":
      return true;
    case "EXTRACTING":
      return now.getTime() - batch.createdAt.getTime() >= STALE_EXTRACTION_MS;
    case "DISCARDED":
      return !batch.hasAppliedCandidate;
    default:
      return false;
  }
}

export interface RetryableScanState {
  readonly status: "READY" | "FAILED";
  readonly createdAt: Date;
  readonly itemCount: number;
  readonly inputTokens: number;
}

/**
 * 減算側の解析が再読み取りの対象か。`READY`は「候補を出せた」ことを表すが、作成から結果の書き込み
 * までのあいだにプロセスが落ちると、`READY`のまま候補もトークンも無い行が残る。
 * 候補が0件でも、応答を受け取っていればトークンが記録されているので区別できる。
 */
export function isRetryableScan(scan: RetryableScanState, now: Date): boolean {
  if (scan.status === "FAILED") return true;
  return (
    scan.itemCount === 0 &&
    scan.inputTokens === 0 &&
    now.getTime() - scan.createdAt.getTime() >= STALE_EXTRACTION_MS
  );
}

/**
 * 再読み取りのために、古い行が持つ一意キー（画像のsha256・指紋）を手放すときの置き換え値。
 * 行そのものは残す——今月の使用量（回数・費用）はその行を数えて出しているため、消すと
 * 払ったぶんが上限から消える。元の値と衝突せず、64文字に収まる。
 */
export function releasedKey(originalKey: string, rowId: string): string {
  return createHash("sha256").update(`released:${rowId}:${originalKey}`).digest("hex");
}
