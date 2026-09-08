"use client";

import { useActionState } from "react";
import Link from "next/link";

import { EMPTY_FORM_STATE, type InventoryFormState } from "@/app/(app)/form-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { categoryOfRole } from "@/lib/disaster/rules";
import {
  EMERGENCY_ROLES,
  EMERGENCY_ROLE_LABELS,
  TEMPERATURE_ZONES,
  TEMPERATURE_ZONE_LABELS,
} from "@/lib/inventory/operations";
import { UNIT_DEFINITIONS } from "@/lib/inventory/units";

/**
 * 商品の防災属性を編集するフォーム（#47）。
 *
 * **在庫の登録・編集フォーム（`StockLotForm`）とは別の画面。** この属性は1商品につき1組で、
 * 家庭内のその商品のすべてのロットに共通で効くため、日常の在庫登録では触らせない
 * （Issueの技術上の前提「登録フォームを防災属性で重くしない」）。
 */

/** 防災の集計（`DISASTER_CATEGORY_RULES`）が実際に数える役割か。それ以外は記録用。 */
const COUNTED_ROLES = new Set(EMERGENCY_ROLES.filter((role) => categoryOfRole(role) !== null));

export interface ProductDisasterFormInitial {
  emergencyRole: string;
  servingsPerUnit: string;
  usesPerUnit: string;
  contentAmount: string;
  contentUnit: string;
  requiresHeating: boolean;
  requiresWater: boolean;
  temperatureZone: string;
}

export function ProductDisasterForm({
  action,
  productId,
  unitLabel,
  initial,
  returnTo,
}: {
  action: (state: InventoryFormState, formData: FormData) => Promise<InventoryFormState>;
  productId: string;
  /** 「1〇〇あたり」の〇〇（商品の既定の単位）。 */
  unitLabel: string;
  initial: ProductDisasterFormInitial;
  returnTo: string;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_FORM_STATE);

  const value = (key: keyof ProductDisasterFormInitial, fallback = ""): string =>
    state.values[key] ?? (initial[key] as string | undefined) ?? fallback;
  const checked = (key: "requiresHeating" | "requiresWater"): boolean =>
    Object.keys(state.values).length > 0 ? state.values[key] === "on" : initial[key];

  const uncountedLabels = EMERGENCY_ROLES.filter((role) => !COUNTED_ROLES.has(role))
    .map((role) => EMERGENCY_ROLE_LABELS[role])
    .join("・");

  return (
    <form action={formAction} className="flex flex-1 flex-col">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="redirectTo" value={returnTo} />

      {state.errors.form ? (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/10 text-destructive mx-4 mt-4 rounded-lg border px-3 py-2 text-sm md:mx-6"
        >
          {state.errors.form}
        </p>
      ) : null}

      <div className="flex flex-col gap-4 px-4 py-4 md:px-6">
        <Field
          label="非常時の役割"
          htmlFor="emergencyRole"
          error={state.errors.emergencyRole}
          hint={`「${uncountedLabels}」は防災ストックの集計には使われません（記録用の区分です）。`}
        >
          <NativeSelect
            id="emergencyRole"
            name="emergencyRole"
            defaultValue={value("emergencyRole", "NONE")}
          >
            {EMERGENCY_ROLES.map((role) => (
              <option key={role} value={role}>
                {EMERGENCY_ROLE_LABELS[role]}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label={`1${unitLabel}あたりの食数`}
            htmlFor="servingsPerUnit"
            error={state.errors.servingsPerUnit}
          >
            <div className="flex items-center gap-2">
              <Input
                id="servingsPerUnit"
                name="servingsPerUnit"
                inputMode="decimal"
                placeholder="未設定"
                defaultValue={value("servingsPerUnit")}
                className="h-11 text-right text-base tabular-nums"
              />
              <span className="text-muted-foreground text-sm">食</span>
            </div>
          </Field>

          <Field
            label={`1${unitLabel}あたりの使用回数`}
            htmlFor="usesPerUnit"
            error={state.errors.usesPerUnit}
          >
            <div className="flex items-center gap-2">
              <Input
                id="usesPerUnit"
                name="usesPerUnit"
                inputMode="decimal"
                placeholder="未設定"
                defaultValue={value("usesPerUnit")}
                className="h-11 text-right text-base tabular-nums"
              />
              <span className="text-muted-foreground text-sm">回</span>
            </div>
          </Field>
        </div>
        <p className="text-muted-foreground -mt-2 text-xs">
          空欄のままだと、その区分（食料・衛生・熱源など）の在庫としては数えられません。
        </p>

        <div className="grid grid-cols-[1fr_8rem] gap-3">
          <Field
            label={`1${unitLabel}あたりの内容量`}
            htmlFor="contentAmount"
            error={state.errors.contentAmount}
          >
            <Input
              id="contentAmount"
              name="contentAmount"
              inputMode="decimal"
              placeholder="未設定"
              defaultValue={value("contentAmount")}
              className="h-11 text-right text-base tabular-nums"
            />
          </Field>

          <Field label="単位" htmlFor="contentUnit" error={state.errors.contentUnit}>
            <NativeSelect
              id="contentUnit"
              name="contentUnit"
              defaultValue={value("contentUnit")}
            >
              <option value="">未設定</option>
              {Object.entries(UNIT_DEFINITIONS).map(([code, definition]) => (
                <option key={code} value={code}>
                  {definition.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <p className="text-muted-foreground -mt-2 text-xs">
          飲料（飲料水・生活用水）のように、本・パックなど個数の単位で登録した在庫を防災の集計へ
          含めたいときに使います（例: 1本 = 2 リットル）。ミリリットル・リットルで登録した在庫は
          設定しなくても数えられます。
        </p>

        <div className="flex flex-col gap-2 rounded-xl border px-4 py-4">
          <h2 className="text-sm font-semibold">食べる・使うときの条件</h2>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="requiresHeating"
              defaultChecked={checked("requiresHeating")}
              className="mt-0.5 size-4"
            />
            <span>
              加熱が必要
              <span className="text-muted-foreground block text-xs">
                熱源の在庫が無いと、防災の集計から外れます（基準の設定で無効化できます）。
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="requiresWater"
              defaultChecked={checked("requiresWater")}
              className="mt-0.5 size-4"
            />
            <span>
              水（給水）が必要
              <span className="text-muted-foreground block text-xs">
                アルファ米のように、水で戻して食べるものに使います。
              </span>
            </span>
          </label>
        </div>

        <Field
          label="保管に必要な温度帯"
          htmlFor="temperatureZone"
          error={state.errors.temperatureZone}
        >
          <NativeSelect
            id="temperatureZone"
            name="temperatureZone"
            defaultValue={value("temperatureZone", "AMBIENT")}
          >
            {TEMPERATURE_ZONES.map((zone) => (
              <option key={zone} value={zone}>
                {TEMPERATURE_ZONE_LABELS[zone]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          冷蔵・冷凍は既定で防災の集計から外れます。実際の判定では、保管場所の温度帯と
          厳しいほうが使われます。
        </p>
      </div>

      <div className="bg-background sticky bottom-0 mt-auto flex gap-2 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6">
        <Button asChild variant="outline" className="h-11 flex-1">
          <Link href={returnTo}>キャンセル</Link>
        </Button>
        <Button type="submit" className="h-11 flex-1" disabled={pending}>
          {pending ? "保存中…" : "保存する"}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor} className="text-xs font-semibold">
        {label}
      </Label>
      {children}
      {error ? (
        <p role="alert" className="text-destructive text-xs font-semibold">
          {error}
        </p>
      ) : hint ? (
        <p className="text-muted-foreground text-xs">{hint}</p>
      ) : null}
    </div>
  );
}

/** `StockLotForm`と同じネイティブ`<select>`。スマホでOSのピッカーを開かせる。 */
function NativeSelect(props: React.ComponentProps<"select">) {
  return (
    <select
      {...props}
      className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-11 w-full rounded-lg border px-3 text-base transition-[color,box-shadow] outline-none focus-visible:ring-3 disabled:opacity-50"
    />
  );
}
