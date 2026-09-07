"use client";

import { useActionState } from "react";

import { createStorageLocationAction } from "@/app/(app)/actions";
import { EMPTY_FORM_STATE } from "@/app/(app)/form-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * 保管場所の追加フォーム。
 *
 * 種類と温度帯を分けているのは、防災の判定（停電時も置いておけるか）が温度帯を見るため。
 * 名前が重複したときのメッセージは`service.ts`が返し、ここは表示だけを行う。
 */
const KINDS = [
  { value: "REFRIGERATOR", label: "冷蔵庫", zone: "CHILLED" },
  { value: "FREEZER", label: "冷凍庫", zone: "FROZEN" },
  { value: "PANTRY", label: "食品棚・パントリー", zone: "AMBIENT" },
  { value: "CUPBOARD", label: "戸棚", zone: "AMBIENT" },
  { value: "CLOSET", label: "収納・クローゼット", zone: "AMBIENT" },
  { value: "EMERGENCY_STOCK", label: "防災バッグ・備蓄", zone: "AMBIENT" },
  { value: "OTHER", label: "そのほか", zone: "AMBIENT" },
] as const;

const ZONES = [
  { value: "AMBIENT", label: "常温" },
  { value: "CHILLED", label: "冷蔵" },
  { value: "FROZEN", label: "冷凍" },
] as const;

export function StorageLocationForm() {
  const [state, formAction, pending] = useActionState(createStorageLocationAction, EMPTY_FORM_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-3 px-4 py-5 md:px-6">
      <h2 className="text-sm font-semibold">保管場所を追加</h2>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="storage-name" className="text-xs font-semibold">
          名前
        </Label>
        <Input
          id="storage-name"
          name="name"
          defaultValue={state.values.name ?? ""}
          placeholder="例: 防災バッグ"
          required
          className="h-11 max-w-sm text-base"
        />
        {state.errors.name ? (
          <p role="alert" className="text-destructive text-xs font-semibold">
            {state.errors.name}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="storage-kind" className="text-xs font-semibold">
            種類
          </Label>
          <select
            id="storage-kind"
            name="kind"
            defaultValue={state.values.kind ?? "OTHER"}
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-11 rounded-lg border px-3 text-base outline-none focus-visible:ring-3"
          >
            {KINDS.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="storage-zone" className="text-xs font-semibold">
            温度帯
          </Label>
          <select
            id="storage-zone"
            name="temperatureZone"
            defaultValue={state.values.temperatureZone ?? "AMBIENT"}
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-11 rounded-lg border px-3 text-base outline-none focus-visible:ring-3"
          >
            {ZONES.map((zone) => (
              <option key={zone.value} value={zone.value}>
                {zone.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {state.errors.form ? (
        <p role="alert" className="text-destructive text-xs font-semibold">
          {state.errors.form}
        </p>
      ) : null}

      <Button type="submit" className="h-11 self-start px-6" disabled={pending}>
        {pending ? "追加中…" : "追加する"}
      </Button>
    </form>
  );
}
