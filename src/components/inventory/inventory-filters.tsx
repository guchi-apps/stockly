import Link from "next/link";
import { Search } from "lucide-react";
import { cn } from "cn";

import { Input } from "@/components/ui/input";
import { EXPIRY_FILTERS, EXPIRY_FILTER_LABELS, type ExpiryFilterKey } from "@/lib/inventory/expiry";
import { getExpiryOverview, listStorageLocations } from "@/lib/inventory/queries";
import type { InventoryContext } from "@/lib/inventory/service";

/**
 * 一覧の絞り込み。
 *
 * チップはすべてリンク、検索はGETのフォームにしてある。クライアント側のJSを待たずに使え、
 * 絞り込んだ状態のURLをそのまま家族へ送れる。
 *
 * **期限の状態と保管場所は行を分ける。** 1列に混ぜると「冷蔵庫」と「期限切れ」が同じ粒度に見え、
 * どちらか一方しか選べないように読めてしまう（実際には掛け合わせられる）。
 */
export interface InventoryFilterState {
  location?: string;
  q?: string;
  expiry?: ExpiryFilterKey;
}

export async function InventoryFilters({
  ctx,
  current,
}: {
  ctx: InventoryContext;
  current: InventoryFilterState;
}) {
  const [locations, overview] = await Promise.all([
    listStorageLocations(ctx),
    getExpiryOverview(ctx),
  ]);

  const counts: Record<ExpiryFilterKey, number> = {
    all: overview.summary.total,
    expired: overview.summary.expired,
    soon: overview.summary.soon,
    unknown: overview.summary.unknown,
  };
  const activeExpiry = current.expiry ?? "all";

  return (
    <div className="flex flex-col gap-3 border-b px-4 py-3 md:px-6">
      <form method="get" action="/inventory" className="flex items-center gap-2">
        {current.location ? <input type="hidden" name="location" value={current.location} /> : null}
        {activeExpiry !== "all" ? (
          <input type="hidden" name="expiry" value={activeExpiry} />
        ) : null}
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

      <ChipRow label="期限">
        {EXPIRY_FILTERS.map((key) => (
          <Chip
            key={key}
            href={buildHref({ q: current.q, location: current.location, expiry: key })}
            active={activeExpiry === key}
            count={counts[key]}
            emphasis={key === "expired" && counts.expired > 0}
          >
            {EXPIRY_FILTER_LABELS[key]}
          </Chip>
        ))}
      </ChipRow>

      <ChipRow label="保管場所">
        <Chip
          href={buildHref({ q: current.q, expiry: activeExpiry })}
          active={!current.location}
        >
          すべて
        </Chip>
        {locations.map((location) => (
          <Chip
            key={location.id}
            href={buildHref({ q: current.q, location: location.id, expiry: activeExpiry })}
            active={current.location === location.id}
            count={location._count.stockLots}
          >
            {location.name}
          </Chip>
        ))}
      </ChipRow>
    </div>
  );
}

function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-muted-foreground w-11 shrink-0 pt-1.5 text-[11px]">{label}</span>
      <div className="-mx-1 flex flex-1 gap-2 overflow-x-auto px-1 pb-1">{children}</div>
    </div>
  );
}

function Chip({
  href,
  active,
  count,
  emphasis = false,
  children,
}: {
  href: string;
  active: boolean;
  count?: number;
  emphasis?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "shrink-0 rounded-full border px-3 py-1 text-xs whitespace-nowrap transition-colors",
        active
          ? "bg-primary text-primary-foreground border-primary font-semibold"
          : emphasis
            ? "border-red-300 text-red-700 dark:border-red-900 dark:text-red-300"
            : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      {typeof count === "number" ? (
        <span className="ml-1.5 tabular-nums opacity-70">{count}</span>
      ) : null}
    </Link>
  );
}

export function buildHref(params: {
  q?: string;
  location?: string;
  expiry?: ExpiryFilterKey;
}): string {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.location) search.set("location", params.location);
  if (params.expiry && params.expiry !== "all") search.set("expiry", params.expiry);
  const query = search.toString();
  return query ? `/inventory?${query}` : "/inventory";
}
