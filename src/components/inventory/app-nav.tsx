"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes, History, MapPin, ScanLine } from "lucide-react";
import { cn } from "cn";

/**
 * 在庫まわりの行き先。PCでは左の列、スマホでは画面下のタブとして同じ内容を出す。
 *
 * 現在地の判定にパスが要るためクライアントコンポーネントにしてある。
 * `/inventory/scan`は「在庫」の下にあるが行き先としては「読取」なので、
 * **前方一致の長いものを優先して選ぶ**（単純な先頭一致だと、読取の画面で「在庫」が光る）。
 */
const ITEMS = [
  { href: "/inventory", label: "在庫", icon: Boxes, matches: ["/inventory"] },
  { href: "/inventory/scan", label: "読取", icon: ScanLine, matches: ["/inventory/scan", "/barcodes"] },
  { href: "/history", label: "履歴", icon: History, matches: ["/history"] },
  { href: "/storage", label: "保管場所", icon: MapPin, matches: ["/storage"] },
] as const;

function useCurrent(): string {
  const pathname = usePathname();

  let current = "";
  let longest = 0;
  for (const item of ITEMS) {
    for (const prefix of item.matches) {
      if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue;
      if (prefix.length <= longest) continue;
      current = item.href;
      longest = prefix.length;
    }
  }
  return current;
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
    <nav className="bg-background/95 fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
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
