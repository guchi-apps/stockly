import type { ReactNode } from "react";
import Link from "next/link";
import { CalendarClock, LifeBuoy, LogOut } from "lucide-react";

import { PageHeader } from "@/components/inventory/chrome";
import { OVERFLOW_ITEMS } from "@/components/inventory/nav-items";
import { Button } from "@/components/ui/button";
import { requireInventoryContext } from "@/lib/inventory/context";

/**
 * スマホの下タブからあふれた行き先をまとめる画面（#7）。
 *
 * 下タブは画面幅を等分するため5つで打ち止めにしてある（`nav-items.ts`）。ここはその
 * 受け皿で、**行き先を足しても下タブが細くならない**ようにするためにある。
 * PC・iPadでは左の縦ナビに全項目が並ぶので、この画面を開く必要はない。
 *
 * ログアウトもここに置く。ログアウトの導線は左のナビの下にしかなく、
 * それはスマホでは隠れているため、この画面ができるまでスマホから抜ける手段が無かった。
 */
const SETTINGS_ITEMS = [
  {
    href: "/disaster/settings",
    label: "防災の基準",
    note: "人数・目標日数・1人1日あたりの必要量",
    icon: LifeBuoy,
  },
  {
    href: "/expiry/settings",
    label: "期限の設定",
    note: "期限間近とみなす日数・通知",
    icon: CalendarClock,
  },
] as const;

export default async function MenuPage() {
  const { userName, householdName } = await requireInventoryContext();

  return (
    <>
      <PageHeader title="メニュー" description={householdName ?? undefined} />

      <div className="flex flex-col gap-5 px-4 py-4 md:px-6">
        <MenuGroup title="在庫を動かす">
          {OVERFLOW_ITEMS.map(({ href, label, note, icon: Icon }) => (
            <MenuLink key={href} href={href} label={label} note={note} icon={<Icon />} />
          ))}
        </MenuGroup>

        <MenuGroup title="設定">
          {SETTINGS_ITEMS.map(({ href, label, note, icon: Icon }) => (
            <MenuLink key={href} href={href} label={label} note={note} icon={<Icon />} />
          ))}
        </MenuGroup>

        <MenuGroup title="このアプリ">
          <li className="flex items-center gap-3 px-3 py-3">
            <span className="bg-muted text-muted-foreground grid size-8 shrink-0 place-items-center rounded-lg">
              <LogOut className="size-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">ログアウト</span>
              <span className="text-muted-foreground block text-xs">
                {userName} としてログイン中
              </span>
            </span>
            <form action="/auth/signout" method="post">
              <Button type="submit" variant="outline" size="sm">
                ログアウト
              </Button>
            </form>
          </li>
        </MenuGroup>

        <p className="text-muted-foreground text-xs">
          PC・iPadでは、これらは画面左のナビにそのまま並びます。
        </p>
      </div>
    </>
  );
}

function MenuGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="text-muted-foreground text-xs font-semibold">{title}</h2>
      <ul className="divide-y rounded-xl border">{children}</ul>
    </section>
  );
}

function MenuLink({
  href,
  label,
  note,
  icon,
}: {
  href: string;
  label: string;
  note: string;
  icon: ReactNode;
}) {
  return (
    <li>
      <Link href={href} className="hover:bg-muted/50 flex items-center gap-3 px-3 py-3">
        <span className="bg-muted text-muted-foreground grid size-8 shrink-0 place-items-center rounded-lg [&_svg]:size-4">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{label}</span>
          <span className="text-muted-foreground block text-xs">{note}</span>
        </span>
        <span className="text-muted-foreground text-sm" aria-hidden>
          ›
        </span>
      </Link>
    </li>
  );
}
