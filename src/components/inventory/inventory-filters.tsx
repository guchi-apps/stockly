import Link from "next/link";
import { Search } from "lucide-react";
import { cn } from "cn";

import { Input } from "@/components/ui/input";
import { listStorageLocations } from "@/lib/inventory/queries";
import type { InventoryContext } from "@/lib/inventory/service";

/**
 * 一覧の絞り込み。
 *
 * チップはすべてリンク、検索はGETのフォームにしてある。クライアント側のJSを待たずに使え、
 * 絞り込んだ状態のURLをそのまま家族へ送れる。
 */
export async function InventoryFilters({
  ctx,
  current,
}: {
  ctx: InventoryContext;
  current: { location?: string; q?: string; expired?: boolean };
}) {
  const locations = await listStorageLocations(ctx);

  const chips = [
    { key: "", label: "すべて", href: buildHref({ q: current.q }) },
    ...locations.map((location) => ({
      key: location.id,
      label: location.name,
      href: buildHref({ q: current.q, location: location.id }),
      count: location._count.stockLots,
    })),
    { key: "expired", label: "期限切れ", href: buildHref({ q: current.q, expired: true }) },
  ];

  const activeKey = current.expired ? "expired" : (current.location ?? "");

  return (
    <div className="flex flex-col gap-3 border-b px-4 py-3 md:px-6">
      <form method="get" action="/inventory" className="flex items-center gap-2">
        {current.location ? <input type="hidden" name="location" value={current.location} /> : null}
        <div className="relative flex-1 md:max-w-sm">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            type="search"
            name="q"
            defaultValue={current.q ?? ""}
            placeholder="商品名で絞り込む"
            aria-label="商品名で絞り込む"
            className="h-10 pl-9"
          />
        </div>
      </form>

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {chips.map((chip) => (
          <Link
            key={chip.key}
            href={chip.href}
            aria-current={activeKey === chip.key ? "true" : undefined}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1 text-xs whitespace-nowrap transition-colors",
              activeKey === chip.key
                ? "bg-primary text-primary-foreground border-primary font-semibold"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {chip.label}
            {"count" in chip && typeof chip.count === "number" ? (
              <span className="ml-1.5 tabular-nums opacity-70">{chip.count}</span>
            ) : null}
          </Link>
        ))}
      </div>
    </div>
  );
}

function buildHref(params: { q?: string; location?: string; expired?: boolean }): string {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.location) search.set("location", params.location);
  if (params.expired) search.set("expired", "1");
  const query = search.toString();
  return query ? `/inventory?${query}` : "/inventory";
}
