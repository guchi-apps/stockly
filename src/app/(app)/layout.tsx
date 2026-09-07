import Link from "next/link";
import { Boxes } from "lucide-react";

import { BottomNav, SideNav } from "@/components/inventory/app-nav";
import { Button } from "@/components/ui/button";
import { requireInventoryContext } from "@/lib/inventory/context";

/**
 * 在庫まわりの画面の外枠。
 *
 * 幅768px以上では左に縦のナビ、それ未満では画面下のタブを出す。スマホでは下タブのぶんだけ
 * 本文の下に余白を置き、最後の行がタブに隠れないようにする。
 */
export default async function InventoryLayout({ children }: LayoutProps<"/">) {
  const { userName, householdName } = await requireInventoryContext();

  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row">
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

      <div className="flex min-w-0 flex-1 flex-col pb-20 md:pb-0">{children}</div>

      <BottomNav />
    </div>
  );
}
