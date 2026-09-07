import { notFound } from "next/navigation";

import { createStockLotAction } from "@/app/(app)/actions";
import { PageHeader } from "@/components/inventory/chrome";
import { StockLotForm } from "@/components/inventory/stock-lot-form";
import { requireInventoryContext } from "@/lib/inventory/context";
import { listInventoryFormOptions } from "@/lib/inventory/queries";
import { newOperationId } from "@/lib/inventory/service";

export default async function NewStockLotPage() {
  const { ctx } = await requireInventoryContext();
  if (!ctx) notFound();

  const { locations, categories } = await listInventoryFormOptions(ctx);

  return (
    <>
      <PageHeader title="在庫を登録" description="購入として履歴に残ります" />
      <StockLotForm
        action={createStockLotAction}
        // 操作IDはこの描画で1つだけ発行する。二重送信されても2件目は記録されない。
        operationId={newOperationId()}
        locations={locations}
        categories={categories}
        submitLabel="登録する"
        cancelHref="/inventory"
      />
    </>
  );
}
