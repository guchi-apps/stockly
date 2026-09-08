import Link from "next/link";
import { MapPin, ScanLine } from "lucide-react";

import { BarcodeList } from "@/components/inventory/barcode-list";
import { ActionNotice, EmptyState, PageHeader, firstValue } from "@/components/inventory/chrome";
import { Button } from "@/components/ui/button";
import { requireInventoryContext } from "@/lib/inventory/context";
import { listBarcodes, listProductOptions } from "@/lib/inventory/queries";

export default async function BarcodesPage({ searchParams }: PageProps<"/barcodes">) {
  const params = await searchParams;
  const { ctx } = await requireInventoryContext();

  if (!ctx) {
    return (
      <EmptyState
        icon={<MapPin className="size-8" />}
        title="家庭が見つかりません"
        description="在庫は家庭に属します。ログインし直しても表示されない場合は、管理者に連絡してください。"
      />
    );
  }

  const [rows, products] = await Promise.all([listBarcodes(ctx), listProductOptions(ctx)]);
  const productCount = new Set(rows.map((row) => row.product.id)).size;

  return (
    <>
      <PageHeader
        title="登録済みのコード"
        description={
          rows.length > 0 ? `${rows.length}件のコードが${productCount}商品に紐付いています` : undefined
        }
        actions={
          <Button asChild size="sm">
            <Link href="/inventory/scan">読み取る</Link>
          </Button>
        }
      />

      <ActionNotice notice={firstValue(params.notice)} error={firstValue(params.error)} />

      {rows.length === 0 ? (
        <EmptyState
          icon={<ScanLine className="size-8" />}
          title="登録済みのコードはまだありません"
          description="バーコードを読み取って在庫を登録すると、そのコードと商品の紐付けがここに残ります。次からは同じコードで前回の内容を呼び出せます。"
          action={
            <Button asChild>
              <Link href="/inventory/scan">読み取る</Link>
            </Button>
          }
        />
      ) : (
        <BarcodeList rows={rows} products={products} />
      )}
    </>
  );
}
