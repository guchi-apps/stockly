"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes, History, MapPin } from "lucide-react";
import { cn } from "cn";

/**
 * 在庫まわりの行き先。PCでは左の列、スマホでは画面下のタブとして同じ内容を出す。
 *
 * 現在地の判定にパスが要るためクライアントコンポーネントにしてある。
 */
const ITEMS = [
  { href: "/inventory", label: "在庫", icon: Boxes },
  { href: "/history", label: "履歴", icon: History },
  { href: "/storage", label: "保管場所", icon: MapPin },
] as const;

function useCurrent(): string {
  const pathname = usePathname();
  const match = ITEMS.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  return match?.href ?? "";
}

/** PC・iPad用の縦のナビ。 */
export function SideNav() {
  const current = useCurrent();

  return (
    <nav className="flex flex-col gap-1">
      {ITEMS.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={current === href ? "page" : undefined}
          className={cn(
            "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
            current === href
              ? "bg-background text-foreground ring-border font-semibold ring-1"
              : "text-muted-foreground hover:text-foreground hover:bg-background/60",
          )}
        >
          <Icon className="size-4" aria-hidden />
          {label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * スマホ用の下タブ。
 *
 * 片手で押せる位置に主要な行き先を置く。`pb-[env(safe-area-inset-bottom)]`は、
 * ホーム画面から起動したときにホームバーへ潜り込ませないため。
 */
export function BottomNav() {
  const current = useCurrent();

  return (
    <nav className="bg-background/95 fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      {ITEMS.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={current === href ? "page" : undefined}
          className={cn(
            "flex flex-col items-center gap-1 py-2.5 text-[11px]",
            current === href ? "text-foreground font-semibold" : "text-muted-foreground",
          )}
        >
          <Icon className="size-5" aria-hidden />
          {label}
        </Link>
      ))}
    </nav>
  );
}
