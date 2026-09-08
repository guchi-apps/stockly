import Link from "next/link";

import { ExpiryBadge } from "@/components/inventory/expiry-badge";
import { RecordButton } from "@/components/inventory/record-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatAmount } from "@/lib/inventory/operations";
import type { ExpiryCandidateGroup } from "@/lib/inventory/queries";
import { UNIT_DEFINITIONS } from "@/lib/inventory/units";

/**
 * 先に消費する候補（FEFO）。
 *
 * 一覧のまま消費を記録できるようにしてあるのは、この画面の目的が「見て終わり」ではなく
 * 「いま減らす」ことだから。詳細を開かせると、消費を1つ記録するのに2画面またぐことになる。
 *
 * 組ごとに出すボタンを変える。期限切れは食べるか捨てるかの二択になりやすいので廃棄を並べ、
 * 期限が未入力のものは数量ではなく**期限を入れること**が次の行動になるため編集へ送る。
 */
export function ConsumptionCandidates({
  groups,
  redirectTo,
}: {
  groups: readonly ExpiryCandidateGroup[];
  redirectTo: string;
}) {
  return (
    <div className="flex flex-col">
      {groups.map((group) => (
        <section key={group.key}>
          <h3 className="text-muted-foreground bg-muted/40 flex items-baseline gap-2 px-4 py-1.5 text-xs font-semibold md:px-6">
            {group.label}
            <span className="font-normal">{group.total}件</span>
            {group.rows.length < group.total ? (
              <span className="font-normal">（{group.rows.length}件まで表示）</span>
            ) : null}
          </h3>

          <ul>
            {group.rows.map((row) => (
              <li key={row.id} className="flex flex-col gap-2 border-b px-4 py-3 md:px-6">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/inventory/${row.id}`}
                      className="hover:underline focus-visible:underline"
                    >
                      <span className="text-[15px] font-semibold">{row.product.name}</span>
                    </Link>
                    <p className="text-muted-foreground truncate text-xs">
                      {[row.storageLocation?.name, row.storagePosition?.name, row.product.brand]
                        .filter(Boolean)
                        .join(" ・ ") || "場所未設定"}
                    </p>
                  </div>
                  <p className="shrink-0 text-[17px] font-semibold tabular-nums">
                    {formatAmount(row.quantity)}
                    <span className="text-muted-foreground ml-0.5 text-xs font-medium">
                      {UNIT_DEFINITIONS[row.unit].label}
                    </span>
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <ExpiryBadge expiry={row.expiry} />
                  {row.openedAt ? (
                    <Badge
                      variant="outline"
                      className="border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-300"
                    >
                      開封済み
                    </Badge>
                  ) : null}
                  <span className="flex-1" />

                  {group.key === "UNKNOWN" ? (
                    <Button asChild variant="outline" size="sm" className="h-9">
                      <Link href={`/inventory/${row.id}/edit`}>期限を入力</Link>
                    </Button>
                  ) : (
                    <>
                      <RecordButton
                        lotId={row.id}
                        type="CONSUME"
                        amount="1"
                        redirectTo={redirectTo}
                        className="h-9 min-w-14"
                      >
                        −1
                      </RecordButton>
                      {group.key === "EXPIRED" && row.quantity.greaterThan(0) ? (
                        <RecordButton
                          lotId={row.id}
                          type="DISPOSE"
                          amount={formatAmount(row.quantity)}
                          redirectTo={redirectTo}
                          className="h-9"
                        >
                          廃棄
                        </RecordButton>
                      ) : null}
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
