import Link from "next/link";
import { notFound } from "next/navigation";

import { createStockLotAction } from "@/app/(app)/actions";
import { PageHeader, firstValue } from "@/components/inventory/chrome";
import { StockLotForm } from "@/components/inventory/stock-lot-form";
import {
  BARCODE_SYMBOLOGY_LABELS,
  formatBarcode,
  parseBarcode,
  type BarcodeSymbology,
} from "@/lib/barcode/code";
import { requireInventoryContext } from "@/lib/inventory/context";
import { InventoryInputError } from "@/lib/inventory/operations";
import { listInventoryFormOptions, lookupBarcode, type BarcodeLookup } from "@/lib/inventory/queries";
import { newOperationId } from "@/lib/inventory/service";

/**
 * 在庫の登録。`?code=`が付いていれば、そのバーコードで前回確定した内容を埋めて出す（#9）。
 *
 * コードが無いときの動きは今までどおり。読み取りからの導線が増えただけで、
 * 手で「在庫を登録」から入った場合に増える手順は無い。
 */
export default async function NewStockLotPage({ searchParams }: PageProps<"/inventory/new">) {
  const params = await searchParams;
  const { ctx } = await requireInventoryContext();
  if (!ctx) notFound();

  const { locations, categories } = await listInventoryFormOptions(ctx);

  const rawCode = firstValue(params.code);
  const fromScan = firstValue(params.from) === "scan";

  let lookup: BarcodeLookup | null = null;
  let symbology: BarcodeSymbology = "OTHER";
  let codeError: string | null = null;

  if (rawCode) {
    try {
      const parsed = parseBarcode(rawCode);
      lookup = await lookupBarcode(ctx, parsed.code);
      // 未登録のコードはDBに記録が無いので、値そのものから推定したシンボロジーを使う。
      symbology = lookup.product ? lookup.symbology : parsed.symbology;
    } catch (error) {
      if (!(error instanceof InventoryInputError)) throw error;
      codeError = error.message;
    }
  }

  return (
    <>
      <PageHeader title="在庫を登録" description="購入として履歴に残ります" />
      <StockLotForm
        action={createStockLotAction}
        // 操作IDはこの描画で1つだけ発行する。二重送信されても2件目は記録されない。
        operationId={newOperationId()}
        locations={locations}
        categories={categories}
        initial={lookup?.candidate.values ?? {}}
        sources={lookup?.candidate.sources ?? {}}
        hidden={
          lookup
            ? { code: lookup.code, symbology, barcodeSource: fromScan ? "scan" : "manual" }
            : {}
        }
        beforeFields={
          codeError ? (
            <CodeErrorBanner message={codeError} />
          ) : lookup ? (
            <BarcodeBanner lookup={lookup} symbology={symbology} />
          ) : null
        }
        submitLabel="登録する"
        cancelHref={lookup ? "/inventory/scan" : "/inventory"}
      />
    </>
  );
}

/** 読み取れたコードと、その照合結果。 */
function BarcodeBanner({
  lookup,
  symbology,
}: {
  lookup: BarcodeLookup;
  symbology: BarcodeSymbology;
}) {
  const known = lookup.product !== null;
  const { confirmedCount } = lookup.candidate;

  return (
    <div
      className={`flex flex-col gap-1.5 rounded-xl border px-4 py-3 ${
        known ? "bg-muted" : "border-dashed"
      }`}
    >
      <p className="flex items-center gap-2">
        <span className="font-mono text-base tracking-widest tabular-nums">
          {formatBarcode(lookup.code)}
        </span>
        <span className="bg-background text-muted-foreground rounded-full px-2 py-px font-mono text-[11px] leading-4">
          {BARCODE_SYMBOLOGY_LABELS[symbology]}
        </span>
      </p>

      {known ? (
        <>
          <p className="text-muted-foreground text-xs">
            {confirmedCount > 0
              ? `「${lookup.product?.name}」として${confirmedCount}回登録しています。前回の内容を入れました。`
              : `「${lookup.product?.name}」に紐付いています。`}
          </p>
          {/*
            商品名を直して登録したときに、コードを新しい商品へ移すかどうか。
            既定でチェックを入れてあるのは、名前を直す＝紐付けが違っていた場合がほとんどだから。
            外して登録すると紐付けは動かず、食い違いだけが数えられて`/barcodes`で知らされる。
          */}
          <label className="mt-1 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              name="rebindBarcode"
              defaultChecked
              className="size-4"
            />
            商品名を変えたら、このコードを新しい商品へ付け替える
          </label>
        </>
      ) : (
        <p className="text-muted-foreground text-xs">
          まだ登録のないコードです。登録すると、次からこの内容を呼び出します。
        </p>
      )}
    </div>
  );
}

/** コードとして読めなかったとき。登録そのものは続けられるようにする。 */
function CodeErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="border-destructive/40 bg-destructive/10 text-destructive flex flex-col gap-1 rounded-xl border px-4 py-3 text-sm"
    >
      <b className="font-semibold">バーコードを読み取れませんでした</b>
      <span className="text-xs">{message}</span>
      <Link href="/inventory/scan" className="text-xs underline underline-offset-2">
        読み取り画面へ戻る
      </Link>
    </div>
  );
}
