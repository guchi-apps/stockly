import Link from "next/link";
import { Boxes } from "lucide-react";
import { cn } from "cn";

import { EmptyState } from "@/components/inventory/chrome";
import { ExpiryBadge } from "@/components/inventory/expiry-badge";
import { RecordButton } from "@/components/inventory/record-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { groupByStorageLocation, listStockLots, type InventoryFilter } from "@/lib/inventory/queries";
import type { InventoryContext } from "@/lib/inventory/service";
import { UNIT_DEFINITIONS } from "@/lib/inventory/units";

/**
 * 在庫の一覧。
 *
 * 一覧のまま±1を記録できるようにしてあるのは、日常の消費が「1つ減らす」の繰り返しだから。
 * 詳細を開かせると、消費を記録するのに2画面またぐことになる。
 *
 * PCでは在庫詳細の画面からもこの一覧を出す（左が一覧・右が詳細）。そのとき選択中の行を
 * `selectedId`で示す。
 */
function isFiltered(filter: InventoryFilter): boolean {
  return Boolean(filter.q || filter.storageLocationId || (filter.expiry && filter.expiry !== "all"));
}

export async function InventoryList({
  ctx,
  filter,
  selectedId,
  redirectTo,
  className,
}: {
  ctx: InventoryContext;
  filter: InventoryFilter;
  selectedId?: string;
  redirectTo: string;
  className?: string;
}) {
  const rows = await listStockLots(ctx, filter);

  if (rows.length === 0) {
    return (
      <div className={cn("flex flex-1 flex-col", className)}>
        <EmptyState
          icon={<Boxes className="size-8" />}
          title={isFiltered(filter) ? "条件に合う在庫がありません" : "まだ在庫がありません"}
          description={
            isFiltered(filter)
              ? "絞り込みを外すと、ほかの在庫が出てきます。"
              : "保管場所を作ってから、最初の在庫を登録します。冷蔵庫・食品棚・防災バッグなどが目安です。"
          }
          action={
            <Button asChild size="lg" className="mt-1">
              <Link href="/inventory/new">在庫を登録する</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const groups = groupByStorageLocation(rows);

  return (
    <div className={cn("flex flex-1 flex-col", className)}>
      {groups.map((group) => (
        <section key={group.id ?? "none"}>
          <h2 className="text-muted-foreground bg-muted/40 flex items-baseline gap-2 px-4 py-1.5 text-xs font-semibold md:px-6">
            {group.name}
            <span className="font-normal">{group.rows.length}件</span>
          </h2>

          <ul>
            {group.rows.map((row) => (
              <li
                key={row.id}
                className={cn(
                  "flex flex-col gap-2 border-b px-4 py-3 md:px-6",
                  row.id === selectedId && "bg-muted/60 shadow-[inset_3px_0_0_var(--primary)]",
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/inventory/${row.id}`}
                      className="hover:underline focus-visible:underline"
                    >
                      <span className="text-[15px] font-semibold">{row.product.name}</span>
                    </Link>
                    <p className="text-muted-foreground truncate text-xs">
                      {[row.product.category?.name, row.storagePosition?.name, row.product.brand]
                        .filter(Boolean)
                        .join(" ・ ") || "カテゴリ未設定"}
                    </p>
                  </div>
                  <p className="shrink-0 text-[17px] font-semibold tabular-nums">
                    {row.quantity.toDecimalPlaces(3).toString()}
                    <span className="text-muted-foreground ml-0.5 text-xs font-medium">
                      {UNIT_DEFINITIONS[row.unit].label}
                    </span>
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <ExpiryBadge expiry={row.expiry} />
                  {row.quantity.isNegative() ? (
                    <Badge variant="destructive">要棚卸</Badge>
                  ) : null}
                  {row.openedAt ? (
                    <Badge
                      variant="outline"
                      className="border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-300"
                    >
                      開封済み
                    </Badge>
                  ) : null}
                  <span className="flex-1" />
                  <RecordButton
                    lotId={row.id}
                    type="CONSUME"
                    amount="1"
                    redirectTo={redirectTo}
                    className="h-9 min-w-14"
                  >
                    −1
                  </RecordButton>
                  <RecordButton
                    lotId={row.id}
                    type="PURCHASE"
                    amount="1"
                    redirectTo={redirectTo}
                    className="h-9 min-w-14"
                  >
                    ＋1
                  </RecordButton>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <p className="text-muted-foreground px-4 py-4 text-xs md:px-6">
        合計 {rows.length}件。数量の変更はすべて履歴に残り、
        <Link href="/history" className="underline underline-offset-2">
          入出庫履歴
        </Link>
        から取り消せます。
      </p>
    </div>
  );
}
