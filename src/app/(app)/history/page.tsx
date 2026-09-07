import Link from "next/link";
import { notFound } from "next/navigation";
import { History } from "lucide-react";

import { ActionNotice, EmptyState, PageHeader, firstValue } from "@/components/inventory/chrome";
import { ReverseButton } from "@/components/inventory/record-form";
import { Badge } from "@/components/ui/badge";
import { requireInventoryContext } from "@/lib/inventory/context";
import { formatQuantityWithUnit } from "@/lib/inventory/operations";
import { listReversedTransactionIds, listTransactions } from "@/lib/inventory/queries";

const TYPE_LABELS: Record<string, string> = {
  PURCHASE: "購入",
  CONSUME: "消費",
  DISPOSE: "廃棄",
  ADJUST: "訂正",
  REVERSAL: "取消",
};

/**
 * 家庭全体の入出庫履歴。
 *
 * **取消は直前の操作に限定しない。** 取り消せる行にはすべて取消ボタンが並び、
 * すでに取り消された行は取消済みとして残る（履歴は消さない）。
 */
export default async function HistoryPage({ searchParams }: PageProps<"/history">) {
  const query = await searchParams;
  const { ctx } = await requireInventoryContext();
  if (!ctx) notFound();

  const [rows, reversedIds] = await Promise.all([
    listTransactions(ctx, { limit: 200 }),
    listReversedTransactionIds(ctx),
  ]);

  return (
    <>
      <PageHeader title="入出庫履歴" description="新しい順に最大200件" />
      <ActionNotice notice={firstValue(query.notice)} error={firstValue(query.error)} />

      {rows.length === 0 ? (
        <EmptyState
          icon={<History className="size-8" />}
          title="まだ履歴がありません"
          description="在庫を登録したり、消費・廃棄を記録すると、ここに並びます。"
        />
      ) : (
        <ul className="flex flex-col">
          {rows.map((row) => {
            const reversed = reversedIds.has(row.id);
            const reversible = row.type !== "REVERSAL" && !reversed;

            return (
              <li key={row.id} className="flex items-center gap-3 border-b px-4 py-3 md:px-6">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex items-center gap-2">
                    <Badge variant="outline">{TYPE_LABELS[row.type]}</Badge>
                    <Link
                      href={`/inventory/${row.stockLot.id}`}
                      className="truncate text-sm font-semibold hover:underline"
                    >
                      {row.stockLot.product.name}
                    </Link>
                    <span
                      className={
                        reversed
                          ? "text-muted-foreground shrink-0 text-sm font-semibold tabular-nums line-through"
                          : "shrink-0 text-sm font-semibold tabular-nums"
                      }
                    >
                      {row.quantityDelta.greaterThan(0) ? "+" : ""}
                      {formatQuantityWithUnit(row.quantityDelta, row.unit)}
                    </span>
                  </span>
                  <span className="text-muted-foreground truncate text-[11px]">
                    {formatDateTime(row.occurredAt)}
                    {row.stockLot.storageLocation ? ` ・ ${row.stockLot.storageLocation.name}` : ""}
                    {row.member?.user ? ` ・ ${row.member.user.name ?? row.member.user.email}` : ""}
                    {row.note ? ` ・ ${row.note}` : ""}
                  </span>
                </div>

                {reversible ? (
                  <ReverseButton transactionId={row.id} redirectTo="/history" />
                ) : (
                  <span className="text-muted-foreground shrink-0 text-[11px]">
                    {row.type === "REVERSAL" ? "取消の記録" : "取消済み"}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function formatDateTime(date: Date): string {
  return date.toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  });
}
