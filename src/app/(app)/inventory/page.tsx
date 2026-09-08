import Link from "next/link";
import { MapPin, Plus } from "lucide-react";

import { ActionNotice, EmptyState, PageHeader, firstValue } from "@/components/inventory/chrome";
import { InventoryFilters, buildHref } from "@/components/inventory/inventory-filters";
import { InventoryList } from "@/components/inventory/inventory-list";
import { Button } from "@/components/ui/button";
import { requireInventoryContext } from "@/lib/inventory/context";
import { parseExpiryFilter } from "@/lib/inventory/expiry";

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
  const expiry = parseExpiryFilter(firstValue(params.expiry));
  const currentPath = buildHref({ location, q, expiry });

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

      <InventoryFilters ctx={ctx} current={{ location, q, expiry }} />

      <InventoryList
        ctx={ctx}
        filter={{ storageLocationId: location ?? null, q: q ?? null, expiry }}
        redirectTo={currentPath}
      />
    </>
  );
}
