import { notFound } from "next/navigation";

import { updateStockLotAction } from "@/app/(app)/actions";
import { PageHeader } from "@/components/inventory/chrome";
import { StockLotForm } from "@/components/inventory/stock-lot-form";
import { requireInventoryContext } from "@/lib/inventory/context";
import { getStockLotDetail, listInventoryFormOptions } from "@/lib/inventory/queries";
import { newOperationId } from "@/lib/inventory/service";

export default async function EditStockLotPage({ params }: PageProps<"/inventory/[lotId]/edit">) {
  const { lotId } = await params;
  const { ctx } = await requireInventoryContext();
  if (!ctx) notFound();

  const [lot, options] = await Promise.all([
    getStockLotDetail(ctx, lotId),
    listInventoryFormOptions(ctx),
  ]);
  if (!lot) notFound();

  return (
    <>
      <PageHeader title="在庫を編集" description={lot.product.name} />
      <StockLotForm
        action={updateStockLotAction}
        operationId={newOperationId()}
        locations={options.locations}
        categories={options.categories}
        lockUnit
        amountHint="数量を変えると、差分が「訂正」として履歴に残ります。"
        initial={{
          productName: lot.product.name,
          categoryName: lot.product.category?.name ?? "",
          amount: lot.quantity.toDecimalPlaces(3).toString(),
          unit: lot.unit,
          storageLocationId: lot.storageLocation?.id ?? "",
          storagePositionId: lot.storagePosition?.id ?? "",
          expiryKind: lot.expiry.kind,
          expiryDate: lot.expiry.date ? lot.expiry.date.toISOString().slice(0, 10) : "",
          opened: lot.openedAt !== null,
          note: lot.note ?? "",
        }}
        hidden={{
          lotId: lot.id,
          // 画面を開いたあとに他の人が更新していたら、送信時に競合として知らせる。
          expectedUpdatedAt: lot.updatedAt.toISOString(),
        }}
        submitLabel="保存する"
        cancelHref={`/inventory/${lot.id}`}
      />
    </>
  );
}
