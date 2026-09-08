/**
 * 取り込んだ画像そのものを返す（#10）。
 *
 * **必ず`queries.ts`を通す。** ここは家庭の在庫の写真（レシートには店名も金額も写る）なので、
 * `scopeToHousehold()`を通らない経路を作ると、idを知っているだけで他家庭の写真が見られる。
 *
 * 保存期間を過ぎた画像は`data`が`null`になっている。その場合は404を返し、
 * 画面には「削除済み」と出す（消えたことと、そもそも無かったことを分けて扱う）。
 */
import { requireInventoryContext } from "@/lib/inventory/context";
import { getIntakeImageData } from "@/lib/intake/queries";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ imageId: string }> },
): Promise<Response> {
  const { imageId } = await params;
  const { ctx } = await requireInventoryContext();
  if (!ctx) return new Response("not found", { status: 404 });

  const image = await getIntakeImageData(ctx, imageId);
  if (!image?.data) return new Response("not found", { status: 404 });

  return new Response(new Uint8Array(image.data), {
    headers: {
      "content-type": image.mimeType,
      // 家庭の写真なので共有キャッシュには載せない。同じ画像を何度も引くのは同じ人だけ。
      "cache-control": "private, max-age=3600",
      "content-disposition": "inline",
    },
  });
}
