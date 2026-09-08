import { notFound } from "next/navigation";

import { updateProductDisasterAttributesAction } from "@/app/(app)/actions";
import { ActionNotice, PageHeader, firstValue } from "@/components/inventory/chrome";
import { ProductDisasterForm } from "@/components/inventory/product-disaster-form";
import { requireInventoryContext } from "@/lib/inventory/context";
import { getProductDisasterAttributes } from "@/lib/inventory/queries";
import { UNIT_DEFINITIONS } from "@/lib/inventory/units";

/**
 * 商品の防災属性の編集画面（#47）。
 *
 * `/inventory/[lotId]`の「防災属性」ボタンから開く。この商品のすべての在庫ロットに
 * 共通で効くため、在庫の登録・編集フォームとは別の画面にしてある。
 */
export default async function ProductDisasterPage({
  params,
  searchParams,
}: PageProps<"/products/[productId]/disaster">) {
  const { productId } = await params;
  const query = await searchParams;
  const { ctx } = await requireInventoryContext();
  if (!ctx) notFound();

  const product = await getProductDisasterAttributes(ctx, productId);
  if (!product) notFound();

  const returnTo = firstValue(query.returnTo) || "/inventory";

  return (
    <>
      <PageHeader title={product.name} description="防災ストックの判定に使う設定・この商品のすべての在庫に共通です" />
      <ActionNotice notice={firstValue(query.notice)} error={firstValue(query.error)} />
      <ProductDisasterForm
        action={updateProductDisasterAttributesAction}
        productId={product.id}
        unitLabel={UNIT_DEFINITIONS[product.defaultUnit].label}
        returnTo={returnTo}
        initial={{
          emergencyRole: product.emergencyRole,
          servingsPerUnit: product.servingsPerUnit ? product.servingsPerUnit.toDecimalPlaces(3).toString() : "",
          usesPerUnit: product.usesPerUnit ? product.usesPerUnit.toDecimalPlaces(3).toString() : "",
          requiresHeating: product.requiresHeating,
          requiresWater: product.requiresWater,
          temperatureZone: product.temperatureZone,
        }}
      />
    </>
  );
}
