import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import {
  dismissBarcodeMismatchAction,
  rebindBarcodeAction,
  unlinkBarcodeAction,
} from "@/app/(app)/actions";
import { SubmitButton } from "@/components/inventory/submit-button";
import { BARCODE_SYMBOLOGY_LABELS, formatBarcode } from "@/lib/barcode/code";
import type { BarcodeRow } from "@/lib/inventory/queries";

/**
 * 登録済みのコード一覧（#9）。
 *
 * 直せる操作は「付け替え」と「解除」の2つだけにしてある。1つのコードは家庭内で1商品にしか
 * 紐付かないので、直し方はこの2つ以外にありえない（増やすと、どれを選べばよいか分からなくなる）。
 */

const BARCODE_SOURCE_LABELS: Readonly<Record<BarcodeRow["source"], string>> = {
  SCAN: "読み取りで登録",
  MANUAL: "手入力で登録",
  EXTERNAL: "外部APIから取得",
};

export function BarcodeList({
  rows,
  products,
}: {
  rows: readonly BarcodeRow[];
  products: readonly { id: string; name: string; brand: string }[];
}) {
  const suspects = rows.filter((row) => row.suspect);
  const rest = rows.filter((row) => !row.suspect);

  return (
    <div className="flex flex-col gap-4 px-4 py-4 md:px-6">
      {suspects.map((row) => (
        <SuspectCard key={row.id} row={row} products={products} />
      ))}

      {rest.length > 0 ? (
        <ul className="divide-y rounded-xl border px-4">
          {rest.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
              <div className="min-w-0 flex-1 basis-full md:basis-auto">
                <p className="truncate text-sm font-medium">
                  {row.product.brand
                    ? `${row.product.name}（${row.product.brand}）`
                    : row.product.name}
                </p>
                <p className="text-muted-foreground font-mono text-xs tracking-wider tabular-nums">
                  {formatBarcode(row.code)} · {BARCODE_SYMBOLOGY_LABELS[row.symbology]} ·{" "}
                  {BARCODE_SOURCE_LABELS[row.source]}
                  {row.useCount > 0 ? ` · ${row.useCount}回` : ""}
                </p>
              </div>
              <RebindForm row={row} products={products} />
              <UnlinkForm row={row} />
            </li>
          ))}
        </ul>
      ) : null}

      <p className="text-muted-foreground text-xs">
        解除してもその商品と在庫は残ります。次に同じコードを読むと、未登録として
        <Link href="/inventory/new" className="underline underline-offset-2">
          登録画面
        </Link>
        へ進みます。
      </p>
    </div>
  );
}

/**
 * 誤紐付けの疑い。
 *
 * 「このコードで読み取ったのに、別の商品として登録された」回数がしきい値を超えたもの。
 * 紐付け側が間違っている見込みが高いので、一覧の先頭で直す手段と一緒に出す。
 */
function SuspectCard({
  row,
  products,
}: {
  row: BarcodeRow;
  products: readonly { id: string; name: string; brand: string }[];
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-900/60 dark:bg-amber-950/30">
      <p className="flex items-center gap-2 font-mono text-sm tracking-wider tabular-nums">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        {formatBarcode(row.code)}
      </p>
      <p className="text-sm font-medium">{row.product.name}</p>
      <p className="text-xs text-amber-800 dark:text-amber-200">
        直近{row.mismatchCount}回、別の商品として登録されています。紐付けが違うかもしれません。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <RebindForm row={row} products={products} label="付け替える" />
        <form action={dismissBarcodeMismatchAction}>
          <input type="hidden" name="barcodeId" value={row.id} />
          <SubmitButton variant="ghost" size="sm" pendingLabel="送信中…">
            そのままにする
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}

function RebindForm({
  row,
  products,
  label = "付け替え",
}: {
  row: BarcodeRow;
  products: readonly { id: string; name: string; brand: string }[];
  label?: string;
}) {
  const others = products.filter((product) => product.id !== row.product.id);
  if (others.length === 0) return null;

  return (
    <form action={rebindBarcodeAction} className="flex items-center gap-2">
      <input type="hidden" name="barcodeId" value={row.id} />
      <label className="sr-only" htmlFor={`product-${row.id}`}>
        {row.code} の付け替え先
      </label>
      <select
        id={`product-${row.id}`}
        name="productId"
        defaultValue=""
        required
        className="border-input bg-background h-9 max-w-48 rounded-lg border px-2 text-sm"
      >
        <option value="" disabled>
          付け替え先を選ぶ
        </option>
        {others.map((product) => (
          <option key={product.id} value={product.id}>
            {product.brand ? `${product.name}（${product.brand}）` : product.name}
          </option>
        ))}
      </select>
      <SubmitButton variant="outline" size="sm" pendingLabel="送信中…">
        {label}
      </SubmitButton>
    </form>
  );
}

function UnlinkForm({ row }: { row: BarcodeRow }) {
  return (
    <form action={unlinkBarcodeAction}>
      <input type="hidden" name="barcodeId" value={row.id} />
      <SubmitButton variant="ghost" size="sm" pendingLabel="送信中…">
        解除
      </SubmitButton>
    </form>
  );
}
