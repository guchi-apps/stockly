import Link from "next/link";
import { MapPin, Plus } from "lucide-react";

import { ActionNotice, EmptyState, PageHeader, firstValue } from "@/components/inventory/chrome";
import { InventoryFilters } from "@/components/inventory/inventory-filters";
import { InventoryList } from "@/components/inventory/inventory-list";
import { Button } from "@/components/ui/button";
import { requireInventoryContext } from "@/lib/inventory/context";

export default async function InventoryPage({ searchParams }: PageProps<"/inventory">) {
  const params = await searchParams;
  const { ctx, householdName } = await requireInventoryContext();

  if (!ctx) {
    return (
      <EmptyState
        icon={<MapPin className="size-8" />}
        title="家庭が見つかりません"
        description="在庫は家庭に属します。ログインし直しても表示されない場合は、管理者に連絡してください。"
      />
    );
  }

  const location = firstValue(params.location);
  const q = firstValue(params.q);
  const expired = firstValue(params.expired) === "1";
  const currentPath = buildPath({ location, q, expired });

  return (
    <>
      <PageHeader
        title="在庫"
        description={householdName ?? undefined}
        actions={
          <Button asChild size="lg">
            <Link href="/inventory/new">
              <Plus className="size-4" aria-hidden />
              在庫を登録
            </Link>
          </Button>
        }
      />

      <ActionNotice notice={firstValue(params.notice)} error={firstValue(params.error)} />

      <InventoryFilters ctx={ctx} current={{ location, q, expired }} />

      <InventoryList
        ctx={ctx}
        filter={{ storageLocationId: location ?? null, q: q ?? null, expiredOnly: expired }}
        redirectTo={currentPath}
      />
    </>
  );
}

function buildPath(params: { location?: string; q?: string; expired?: boolean }): string {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.location) search.set("location", params.location);
  if (params.expired) search.set("expired", "1");
  const query = search.toString();
  return query ? `/inventory?${query}` : "/inventory";
}
