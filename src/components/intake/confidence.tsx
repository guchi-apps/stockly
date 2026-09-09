/**
 * 候補の確からしさと「読めなかった欄」の見せ方（#10）。
 *
 * **色だけで表さない。** 記号（塗りつぶしのブロック）・語（高／中／低）・数値（%）を必ず併記し、
 * 読めなかった欄は斜線と文言で示す。防災の充足率（#8の`CoverageBar`）と同じ約束で、
 * 色が見分けにくい環境でも「確からしいのか」「そもそも読めていないのか」が伝わるようにする。
 */
import { AlertTriangle } from "lucide-react";

import { CONFIDENCE_LABELS, confidenceLevel } from "@/lib/intake/candidates";

const BLOCKS = 5;

export function ConfidenceMeter({ value, label = "確からしさ" }: { value: number | null; label?: string }) {
  if (value === null) return null;

  const level = confidenceLevel(value);
  const filled = Math.max(1, Math.round(value * BLOCKS));
  const percent = Math.round(value * 100);

  return (
    <span
      className="text-muted-foreground inline-flex items-center gap-1.5 text-[11px] whitespace-nowrap"
      title={`${label} ${CONFIDENCE_LABELS[level]}（${percent}%）`}
    >
      <span className="text-foreground font-mono tracking-tight" aria-hidden>
        {"▮".repeat(filled)}
        {"▯".repeat(BLOCKS - filled)}
      </span>
      {label} {CONFIDENCE_LABELS[level]}
      <span className="tabular-nums">{percent}%</span>
    </span>
  );
}

/**
 * 読めなかった欄。**空欄のまま出す**のが大事で、0や「未設定」で埋めない
 * （「読めなかった」と「そう読めた」の区別が消える）。
 */
export function Unreadable({ what }: { what: string }) {
  return (
    <span className="border-destructive text-destructive inline-flex items-center gap-1.5 rounded-lg border border-dashed px-2 py-0.5 text-xs font-semibold">
      <AlertTriangle className="size-3.5" aria-hidden />
      {what}を読めませんでした
    </span>
  );
}
