import {
  CANDIDATE_SOURCE_LABELS,
  type CandidateSource,
} from "@/lib/barcode/candidate";

/**
 * 候補の値がどこから来たか（#9・#10）。
 *
 * 優先順位が高いものほど強い見た目にして、並べたときに順位が読めるようにする。
 * 確定済みルール（自分が前回決めた値）＝塗り、バーコードマスタ＝枠線、AI候補＝破線。
 *
 * **在庫の登録フォーム（`stock-lot-form.tsx`）と写真取込の候補（`intake/candidate-card.tsx`）が
 * 同じものを出すため、ここに置いてある。** 片方だけ見た目を変えると、同じ「AI候補」が
 * 画面によって違うものに見える。
 */
export function SourceChip({ source }: { source: CandidateSource }) {
  const style = {
    RULE: "bg-foreground text-background font-semibold",
    BARCODE: "text-foreground ring-1 ring-foreground",
    AI: "text-muted-foreground ring-1 ring-dashed ring-border",
  }[source];

  return (
    <span className={`rounded-full px-2 py-px text-[11px] leading-4 ${style}`}>
      {CANDIDATE_SOURCE_LABELS[source]}
    </span>
  );
}
