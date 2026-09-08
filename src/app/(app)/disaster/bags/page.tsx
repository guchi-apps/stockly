import Link from "next/link";
import { Backpack, LifeBuoy } from "lucide-react";

import { BagCard } from "@/components/disaster/bag-inspection";
import { ActionNotice, EmptyState, PageHeader, firstValue } from "@/components/inventory/chrome";
import { Button } from "@/components/ui/button";
import { needsInspection } from "@/lib/disaster/bag";
import { listDisasterBags } from "@/lib/disaster/bag-queries";
import { requireInventoryContext } from "@/lib/inventory/context";

/**
 * 防災バッグの一覧（#8）。
 *
 * **バッグの実体は保管場所（種別が「防災用品」）そのもので、防災用の別在庫は作らない。**
 * 中身は普通の在庫なので、非常時のために買ったものも日常の在庫として減らせる。
 *
 * 並びは「点検が要るもの（未点検・期限切れ）が先」。一覧を上から見れば、
 * いま手を入れるべきバッグだけが目に入る。
 */
export default async function DisasterBagsPage({ searchParams }: PageProps<"/disaster/bags">) {
  const params = await searchParams;
  const { ctx, householdName } = await requireInventoryContext();

  if (!ctx) {
    return (
      <EmptyState
        icon={<LifeBuoy className="size-8" />}
        title="家庭が見つかりません"
        description="防災バッグの点検は家庭の在庫から出します。ログインし直しても表示されない場合は、管理者に連絡してください。"
      />
    );
  }

  const bags = await listDisasterBags(ctx);
  const pending = bags.filter((bag) => needsInspection(bag.inspection));

  return (
    <>
      <PageHeader
        title="防災バッグ"
        description={`${householdName ? `${householdName} ・ ` : ""}${
          bags.length === 0
            ? "保管場所の種別が「防災用品」のものが点検の単位になります"
            : `${bags.length}件のうち${pending.length}件に点検が要ります`
        }`}
        actions={
          <Button asChild variant="outline">
            <Link href="/disaster">
              <LifeBuoy className="size-4" aria-hidden />
              防災ストック
            </Link>
          </Button>
        }
      />

      <ActionNotice notice={firstValue(params.notice)} error={firstValue(params.error)} />

      {bags.length === 0 ? (
        <EmptyState
          icon={<Backpack className="size-8" />}
          title="点検する防災バッグがありません"
          description="保管場所の種別を「防災用品」にすると、そこに入っている在庫を1つのバッグとして点検できるようになります。"
          action={
            <Button asChild variant="outline">
              <Link href="/storage">保管場所を設定する</Link>
            </Button>
          }
        />
      ) : (
        <>
          <h2 className="text-muted-foreground bg-muted/40 mt-4 flex items-baseline gap-2 border-y px-4 py-1.5 text-xs font-semibold md:px-6">
            バッグごとの状態
            <span className="font-normal">点検が要るものを先に出しています</span>
          </h2>

          <ul className="grid gap-2.5 px-4 py-4 md:grid-cols-2 md:px-6">
            {bags.map((bag) => (
              <BagCard key={bag.storageLocationId} bag={bag} />
            ))}
          </ul>

          <p className="text-muted-foreground px-4 pb-6 text-[11px] leading-relaxed md:px-6">
            充足は防災ストックと同じ判定（ルールエンジン）で出しています。ここが使うのは
            バッグごとの目標（既定は1人・1日ぶん）だけで、1人1日あたりの必要量や
            「冷蔵を数えるか」は家庭全体の基準をそのまま使います。
          </p>
        </>
      )}
    </>
  );
}
