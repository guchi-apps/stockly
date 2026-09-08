"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes, CalendarClock, History, MapPin, ShoppingCart } from "lucide-react";
import { cn } from "cn";

/**
 * 在庫まわりの行き先。PCでは左の列、スマホでは画面下のタブとして同じ内容を出す。
 *
 * 現在地の判定にパスが要るためクライアントコンポーネントにしてある。
 */
const ITEMS = [
  { href: "/inventory", label: "在庫", icon: Boxes },
  { href: "/expiry", label: "期限", icon: CalendarClock },
  { href: "/history", label: "履歴", icon: History },
  { href: "/replenishment", label: "補充", icon: ShoppingCart },
  { href: "/storage", label: "保管場所", icon: MapPin },
] as const;

/**
 * 下タブの列数。**`grid-cols-${n}`のような動的なクラス名はTailwindが拾えない**ため、
 * 使いうる列数のクラスを並べて`ITEMS.length`で引く。
 *
 * 行き先を足すIssueが同時に走っている（#5・#9）。ここを`grid-cols-4`と決め打ちにすると、
 * 項目を足す全員が同じ1行を書き換えることになり、必ず衝突する。
 */
const BOTTOM_NAV_COLUMNS: Readonly<Record<number, string>> = {
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
};

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
    <nav
      className={cn(
        "bg-background/95 fixed inset-x-0 bottom-0 z-20 grid border-t pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden",
        BOTTOM_NAV_COLUMNS[ITEMS.length] ?? "grid-cols-4",
      )}
    >
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
