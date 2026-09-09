import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, LifeBuoy, Pencil } from "lucide-react";

import { recordTransactionAction } from "@/app/(app)/actions";
import { ActionNotice, PageHeader, firstValue } from "@/components/inventory/chrome";
import { ExpiryBadge } from "@/components/inventory/expiry-badge";
import { InventoryList } from "@/components/inventory/inventory-list";
import { ReverseButton } from "@/components/inventory/record-form";
import { SubmitButton } from "@/components/inventory/submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireInventoryContext } from "@/lib/inventory/context";
import { canReverse, formatQuantityWithUnit } from "@/lib/inventory/operations";
import { getStockLotDetail } from "@/lib/inventory/queries";
import { newOperationId } from "@/lib/inventory/service";
import { formatTokyoDate } from "@/lib/time/tokyo";
import { UNIT_DEFINITIONS } from "@/lib/inventory/units";

const TYPE_LABELS: Record<string, string> = {
  PURCHASE: "購入",
  CONSUME: "消費",
  DISPOSE: "廃棄",
  ADJUST: "訂正",
  REVERSAL: "取消",
};

export default async function StockLotPage({ params, searchParams }: PageProps<"/inventory/[lotId]">) {
  const { lotId } = await params;
  const query = await searchParams;
  const { ctx } = await requireInventoryContext();
  if (!ctx) notFound();

  const lot = await getStockLotDetail(ctx, lotId);
  if (!lot) notFound();

  const backTo = `/inventory/${lot.id}`;
  const unitLabel = UNIT_DEFINITIONS[lot.unit].label;

  return (
    <div className="flex min-h-full flex-1">
      {/* PCでは左に一覧を残し、どの在庫を見ているかが分かるようにする。 */}
      <div className="hidden min-w-0 flex-1 flex-col border-r md:flex">
        <PageHeader title="在庫" />
        <InventoryList ctx={ctx} filter={{}} selectedId={lot.id} redirectTo={backTo} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col md:max-w-md lg:max-w-lg">
        <PageHeader
          title={lot.product.name}
          description={
            [lot.storageLocation?.name, lot.storagePosition?.name].filter(Boolean).join(" ・ ") ||
            "場所未設定"
          }
          actions={
            <>
              <Button asChild variant="ghost" size="icon-lg" className="md:hidden">
                <Link href="/inventory" aria-label="在庫一覧へ戻る">
                  <ArrowLeft className="size-4" aria-hidden />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href={`/products/${lot.product.id}/disaster?returnTo=${encodeURIComponent(backTo)}`}>
                  <LifeBuoy className="size-4" aria-hidden />
                  防災属性
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href={`/inventory/${lot.id}/edit`}>
                  <Pencil className="size-4" aria-hidden />
                  編集
                </Link>
              </Button>
            </>
          }
        />

        <ActionNotice notice={firstValue(query.notice)} error={firstValue(query.error)} />

        <section className="flex flex-col gap-3 border-b px-4 py-4 md:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <ExpiryBadge expiry={lot.expiry} detailed />
            {lot.openedAt ? (
              <Badge
                variant="outline"
                className="border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-300"
              >
                使用中
              </Badge>
            ) : null}
            {lot.status !== "ACTIVE" ? (
              <Badge variant="outline">
                {lot.status === "DISCARDED" ? "廃棄済み" : "使い切り"}
              </Badge>
            ) : null}
          </div>

          <p className="flex items-baseline gap-1.5">
            <span className="text-4xl font-semibold tracking-tight tabular-nums">
              {lot.quantity.toDecimalPlaces(3).toString()}
            </span>
            <span className="text-muted-foreground text-base">{unitLabel}</span>
          </p>

          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">カテゴリ</dt>
            <dd>{lot.product.category?.name ?? "未設定"}</dd>
            <dt className="text-muted-foreground">保管場所</dt>
            <dd>
              {[lot.storageLocation?.name, lot.storagePosition?.name].filter(Boolean).join(" ・ ") ||
                "未設定"}
            </dd>
            {lot.expiry.date ? (
              <>
                <dt className="text-muted-foreground">期限</dt>
                <dd>{formatTokyoDate(lot.expiry.date)}</dd>
              </>
            ) : null}
            {lot.note ? (
              <>
                <dt className="text-muted-foreground">メモ</dt>
                <dd className="break-words">{lot.note}</dd>
              </>
            ) : null}
          </dl>

          {lot.quantity.isNegative() ? (
            <p className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-xs leading-relaxed">
              数量がマイナスになっています。取り消した記録より後の消費が残っているためで、履歴は
              そのままで正しい状態です。実際の数を「編集」から入れ直すと、差分が訂正として記録されます。
            </p>
          ) : null}

          {lot.expiry.status === "EXPIRED" ? (
            <p className="text-muted-foreground text-xs leading-relaxed">
              期限切れのため、防災の備蓄量には算入されません（在庫としては残ります）。
            </p>
          ) : null}

          {lot.expiry.status === "UNKNOWN" ? (
            <p className="text-muted-foreground text-xs leading-relaxed">
              期限が入っていません。期限内かどうかを判断できないため、「要確認」として
              <Link href="/expiry" className="underline underline-offset-2">
                期限
              </Link>
              の画面に出ます。パッケージを見て「編集」から入れてください。
            </p>
          ) : null}
        </section>

        {/*
          数量の入力と3つのボタンを1つのフォームにしてある。押されたボタンの name/value だけが
          送られるので、`operationId`は1レンダーにつき1つで足りる（同じボタンの二重送信は
          service.ts側が「記録済み」として弾く）。
        */}
        <form
          action={recordTransactionAction}
          className="flex flex-wrap items-end gap-2 border-b px-4 py-4 md:px-6"
        >
          <input type="hidden" name="operationId" value={newOperationId()} />
          <input type="hidden" name="lotId" value={lot.id} />
          <input type="hidden" name="redirectTo" value={backTo} />

          <div className="flex flex-col gap-1">
            <label htmlFor="record-amount" className="text-muted-foreground text-xs font-medium">
              数量（{unitLabel}）
            </label>
            <Input
              id="record-amount"
              name="amount"
              defaultValue="1"
              inputMode="decimal"
              className="h-11 w-24 text-base"
            />
          </div>

          <div className="flex flex-1 flex-wrap gap-2">
            <SubmitButton name="type" value="PURCHASE" className="h-11 flex-1">
              補充
            </SubmitButton>
            <SubmitButton name="type" value="CONSUME" className="h-11 flex-1">
              消費
            </SubmitButton>
            <SubmitButton name="type" value="DISPOSE" variant="destructive" className="h-11 flex-1">
              廃棄
            </SubmitButton>
          </div>
        </form>

        <section className="flex flex-col px-4 py-4 md:px-6">
          <h2 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide">
            入出庫履歴
          </h2>

          <ul>
            {lot.transactions.map((transaction) => {
              const reversible = canReverse(transaction, lot.transactions);
              const reversed =
                transaction.type !== "REVERSAL" &&
                lot.transactions.some((row) => row.reversesTransactionId === transaction.id);

              return (
                <li
                  key={transaction.id}
                  className="flex items-center gap-3 border-b py-2.5 last:border-b-0"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-2 text-sm">
                      <Badge variant="outline">{TYPE_LABELS[transaction.type]}</Badge>
                      <span
                        className={
                          reversed
                            ? "text-muted-foreground font-semibold tabular-nums line-through"
                            : "font-semibold tabular-nums"
                        }
                      >
                        {transaction.quantityDelta.greaterThan(0) ? "+" : ""}
                        {formatQuantityWithUnit(transaction.quantityDelta, transaction.unit)}
                      </span>
                    </span>
                    <span className="text-muted-foreground truncate text-[11px]">
                      {formatDateTime(transaction.occurredAt)}
                      {transaction.member?.user
                        ? ` ・ ${transaction.member.user.name ?? transaction.member.user.email}`
                        : ""}
                      {transaction.note ? ` ・ ${transaction.note}` : ""}
                    </span>
                  </div>

                  {reversible ? (
                    <ReverseButton transactionId={transaction.id} redirectTo={backTo} />
                  ) : (
                    <span className="text-muted-foreground shrink-0 text-[11px]">
                      {transaction.type === "REVERSAL" ? "取消の記録" : "取消済み"}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>

          <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
            取消は履歴を消さず、符号を反転した記録を足して数量を戻します。直前の操作でなくても
            取り消せます。
          </p>
        </section>
      </div>
    </div>
  );
}

/** 履歴は日時まで見せる。同じ日に何度も記録するため、日付だけでは並びが読めない。 */
function formatDateTime(date: Date): string {
  return date.toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  });
}
