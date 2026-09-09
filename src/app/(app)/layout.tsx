import Link from "next/link";
import { Boxes } from "lucide-react";

import { BottomNav, SideNav } from "@/components/inventory/app-nav";
import { ConnectionStatus } from "@/components/inventory/connection-status";
import { Button } from "@/components/ui/button";
import { requireInventoryContext } from "@/lib/inventory/context";
import { getInventoryRevision } from "@/lib/inventory/queries";
import { formatTokyoDateTime } from "@/lib/time/tokyo";

/**
 * 在庫まわりの画面の外枠。
 *
 * 幅768px以上では左に縦のナビ、それ未満では画面下のタブを出す。スマホでは下タブのぶんだけ
 * 本文の下に余白を置き、最後の行がタブに隠れないようにする。
 *
 * 左右の`env(safe-area-inset-*)`は、iPhoneを横向きにしたときにノッチ側へ本文が
 * 潜り込まないようにするため（#12。効かせるには`viewport-fit=cover`が要る＝`app/layout.tsx`）。
 */
export default async function InventoryLayout({ children }: LayoutProps<"/">) {
  const { ctx, userName, householdName } = await requireInventoryContext();

  // 端末をまたいだ同期の基準（#12）。画面が描かれるたびに最新へ揃うので、
  // 自分で記録した直後に「ほかの端末で更新されました」が出ることはない。
  const revision = ctx ? await getInventoryRevision(ctx) : null;

  return (
    <div className="flex min-h-full flex-1 flex-col pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] md:flex-row">
      <aside className="bg-muted/40 hidden w-56 shrink-0 flex-col gap-6 border-r p-4 md:flex">
        <Link href="/inventory" className="flex items-center gap-2 px-1">
          <span className="bg-primary text-primary-foreground grid size-7 place-items-center rounded-lg">
            <Boxes className="size-4" aria-hidden />
          </span>
          <span className="text-base font-semibold tracking-tight">Stockly</span>
        </Link>

        <SideNav />

        <div className="text-muted-foreground mt-auto flex flex-col gap-2 border-t pt-3 text-xs">
          <span className="text-foreground font-medium">{householdName ?? "家庭が未設定"}</span>
          <span>{userName}</span>
          <form action="/auth/signout" method="post">
            <Button type="submit" variant="ghost" size="sm" className="px-1">
              ログアウト
            </Button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0">
        <ConnectionStatus revision={revision} loadedAt={formatTokyoDateTime(new Date())} />
        {children}
      </div>

      <BottomNav />
    </div>
  );
}
