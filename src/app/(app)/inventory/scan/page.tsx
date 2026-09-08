import Link from "next/link";
import { MapPin } from "lucide-react";

import { BarcodeScanner } from "@/components/inventory/barcode-scanner";
import { EmptyState, PageHeader } from "@/components/inventory/chrome";
import { Button } from "@/components/ui/button";
import { formatBarcode } from "@/lib/barcode/code";
import { requireInventoryContext } from "@/lib/inventory/context";
import { listBarcodes } from "@/lib/inventory/queries";

/** 最近使ったコードとして出す件数。ここは思い出す手がかりで、一覧は`/barcodes`が持つ。 */
const RECENT_LIMIT = 3;

export default async function ScanPage() {
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

  const barcodes = await listBarcodes(ctx);
  const recent = barcodes.filter((barcode) => barcode.lastUsedAt).slice(0, RECENT_LIMIT);

  return (
    <>
      <PageHeader
        title="バーコードを読み取る"
        description="JAN・EANから前回登録した内容を呼び出します"
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/barcodes">登録済みのコード</Link>
          </Button>
        }
      />

      <div className="flex flex-col gap-6 px-4 py-4 md:px-6">
        <BarcodeScanner />

        {recent.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold">最近使ったコード</h2>
            <ul className="divide-y rounded-xl border px-4">
              {recent.map((barcode) => (
                <li key={barcode.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{barcode.product.name}</p>
                    <p className="text-muted-foreground font-mono text-xs tracking-wider">
                      {formatBarcode(barcode.code)}
                    </p>
                  </div>
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`/inventory/new?code=${barcode.code}&from=manual`}>登録へ</Link>
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  );
}
