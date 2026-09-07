import { notFound } from "next/navigation";
import { MapPin, Plus, Trash2 } from "lucide-react";

import {
  createDefaultStorageLocationsAction,
  createStoragePositionAction,
  deleteStorageLocationAction,
  deleteStoragePositionAction,
  renameStorageLocationAction,
} from "@/app/(app)/actions";
import { ActionNotice, EmptyState, PageHeader, firstValue } from "@/components/inventory/chrome";
import { StorageLocationForm } from "@/components/inventory/storage-location-form";
import { SubmitButton } from "@/components/inventory/submit-button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { requireInventoryContext } from "@/lib/inventory/context";
import { listStorageLocations } from "@/lib/inventory/queries";

const TEMPERATURE_LABELS: Record<string, string> = {
  AMBIENT: "常温",
  CHILLED: "冷蔵",
  FROZEN: "冷凍",
};

export default async function StoragePage({ searchParams }: PageProps<"/storage">) {
  const query = await searchParams;
  const { ctx } = await requireInventoryContext();
  if (!ctx) notFound();

  const locations = await listStorageLocations(ctx);

  return (
    <>
      <PageHeader title="保管場所" description="場所と、その中の詳細位置" />
      <ActionNotice notice={firstValue(query.notice)} error={firstValue(query.error)} />

      {locations.length === 0 ? (
        <EmptyState
          icon={<MapPin className="size-8" />}
          title="保管場所がまだありません"
          description="冷蔵庫・冷凍庫・食品棚・防災バッグ・洗面所をまとめて作れます。あとから名前を変えたり足したりできます。"
          action={
            <form action={createDefaultStorageLocationsAction}>
              <SubmitButton size="lg" variant="default" className="h-11" pendingLabel="作成中…">
                よく使う保管場所を作る
              </SubmitButton>
            </form>
          }
        />
      ) : (
        <ul className="flex flex-col">
          {locations.map((location) => (
            <li key={location.id} className="flex flex-col gap-3 border-b px-4 py-4 md:px-6">
              <div className="flex flex-wrap items-center gap-2">
                {/* 名前は入力欄そのものにして、直したらその場で保存できるようにする。 */}
                <form
                  action={renameStorageLocationAction}
                  className="flex min-w-0 flex-1 items-center gap-2"
                >
                  <input type="hidden" name="storageLocationId" value={location.id} />
                  <Input
                    name="name"
                    defaultValue={location.name}
                    aria-label={`${location.name}の名前`}
                    className="h-10 max-w-56 text-base font-semibold"
                  />
                  <SubmitButton variant="ghost" className="h-10" pendingLabel="保存中…">
                    名前を保存
                  </SubmitButton>
                </form>

                <Badge variant="outline">{TEMPERATURE_LABELS[location.temperatureZone]}</Badge>
                <Badge variant="outline">在庫 {location._count.stockLots}件</Badge>

                <form action={deleteStorageLocationAction}>
                  <input type="hidden" name="storageLocationId" value={location.id} />
                  <SubmitButton
                    variant="ghost"
                    size="icon-lg"
                    aria-label={`${location.name}を削除`}
                    className="text-muted-foreground"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </SubmitButton>
                </form>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {location.positions.map((position) => (
                  <form key={position.id} action={deleteStoragePositionAction} className="contents">
                    <input type="hidden" name="storagePositionId" value={position.id} />
                    <span className="text-muted-foreground inline-flex items-center gap-1 rounded-lg border border-dashed px-2.5 py-1 text-xs">
                      {position.name}
                      <span className="tabular-nums opacity-70">{position._count.stockLots}</span>
                      <SubmitButton
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`${position.name}を削除`}
                      >
                        ×
                      </SubmitButton>
                    </span>
                  </form>
                ))}

                <form action={createStoragePositionAction} className="flex items-center gap-1">
                  <input type="hidden" name="storageLocationId" value={location.id} />
                  <Input
                    name="name"
                    placeholder="詳細位置を追加"
                    aria-label={`${location.name}に詳細位置を追加`}
                    className="h-9 w-40 text-sm"
                  />
                  <SubmitButton className="h-9">
                    <Plus className="size-3.5" aria-hidden />
                    追加
                  </SubmitButton>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      <StorageLocationForm />
    </>
  );
}
