import type { ReactNode } from "react";

import { recordTransactionAction, reverseTransactionAction } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import { newOperationId } from "@/lib/inventory/service";
import type { RecordableTransactionType } from "@/lib/inventory/operations";

/**
 * 数量を1件記録するボタン。
 *
 * **`operationId`はこのフォームを描くたびに1つ発行する。** 同じフォームを二重送信しても
 * IDは同じなので、2件目は`service.ts`側で「記録済み」として弾かれ、数量は二重に動かない。
 * 記録が済むと画面が再描画され、次の操作には新しいIDが割り当てられる。
 */
export function RecordButton({
  lotId,
  type,
  amount,
  redirectTo,
  children,
  variant = "outline",
  className,
}: {
  lotId: string;
  type: RecordableTransactionType;
  amount: string;
  redirectTo: string;
  children: ReactNode;
  variant?: "outline" | "default" | "destructive" | "ghost";
  className?: string;
}) {
  return (
    <form action={recordTransactionAction} className="contents">
      <input type="hidden" name="operationId" value={newOperationId()} />
      <input type="hidden" name="lotId" value={lotId} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="amount" value={amount} />
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <Button type="submit" variant={variant} size="sm" className={className}>
        {children}
      </Button>
    </form>
  );
}

/** 履歴を1件取り消すボタン。取消の二重送信も同じ仕組みで防ぐ。 */
export function ReverseButton({
  transactionId,
  redirectTo,
  label = "取消",
}: {
  transactionId: string;
  redirectTo: string;
  label?: string;
}) {
  return (
    <form action={reverseTransactionAction}>
      <input type="hidden" name="operationId" value={newOperationId()} />
      <input type="hidden" name="transactionId" value={transactionId} />
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <Button type="submit" variant="ghost" size="sm" className="text-muted-foreground h-8">
        {label}
      </Button>
    </form>
  );
}
