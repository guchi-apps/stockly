"use client";

import { useActionState } from "react";
import Link from "next/link";

import { EMPTY_FORM_STATE, type InventoryFormState } from "@/app/(app)/form-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * 防災の基準のフォーム（#7）。
 *
 * **「何を数えるか」のチェックは、既定で数えないものを含める側に倒す。** 冷蔵・冷凍・開封済みを
 * 数えると備蓄日数が実際より長く出るので、含めることを利用者が明示したときだけ数える
 * （受入条件の「明示設定なしに例外化しない」）。期限切れ・期限が未入力の在庫は、
 * どの設定でも数えないためチェックを置かない。
 */
export interface DisasterPlanFormInitial {
  peopleCount: string;
  targetDays: string;
  waterLitersPerPersonDay: string;
  foodServingsPerPersonDay: string;
  sanitationUsesPerPersonDay: string;
  lightingUnitsPerPerson: string;
  powerUnitsPerPerson: string;
  heatSourceUsesPerDay: string;
  includeChilled: boolean;
  includeFrozen: boolean;
  includeOpened: boolean;
  requireHeatSourceForHeating: boolean;
  requireWaterForRehydration: boolean;
}

type NumberKey = Extract<
  keyof DisasterPlanFormInitial,
  | "peopleCount"
  | "targetDays"
  | "waterLitersPerPersonDay"
  | "foodServingsPerPersonDay"
  | "sanitationUsesPerPersonDay"
  | "lightingUnitsPerPerson"
  | "powerUnitsPerPerson"
  | "heatSourceUsesPerDay"
>;

type CheckKey = Exclude<keyof DisasterPlanFormInitial, NumberKey>;

export function DisasterPlanSettingsForm({
  action,
  initial,
  ruleVersion,
  isDefault,
}: {
  action: (state: InventoryFormState, formData: FormData) => Promise<InventoryFormState>;
  initial: DisasterPlanFormInitial;
  ruleVersion: string;
  isDefault: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_FORM_STATE);

  const value = (key: NumberKey): string => state.values[key] ?? initial[key];
  // 一度でも送信していれば、チェックの状態は送信された値だけで決まる
  // （チェックを外した欄はFormDataに入らないため、初期値へ戻してはいけない）。
  const checked = (key: CheckKey): boolean =>
    Object.keys(state.values).length > 0 ? state.values[key] === "on" : initial[key];

  return (
    <form action={formAction} className="flex flex-1 flex-col">
      {state.errors.form ? (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/10 text-destructive mx-4 mt-4 rounded-lg border px-3 py-2 text-sm md:mx-6"
        >
          {state.errors.form}
        </p>
      ) : null}

      <div className="flex flex-col gap-4 px-4 py-4 md:px-6">
        <section className="flex flex-col gap-3 rounded-xl border px-4 py-4">
          <div>
            <h2 className="text-sm font-semibold">何人ぶんを、何日ぶん備えるか</h2>
            <p className="text-muted-foreground text-xs">
              この2つが必要量のもとになります。1人1日あたりの量に、人数と日数を掛けます。
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <NumberField
              id="peopleCount"
              label="人数"
              suffix="人"
              hint="在庫を分け合う人数"
              defaultValue={value("peopleCount")}
              error={state.errors.peopleCount}
            />
            <NumberField
              id="targetDays"
              label="目標日数"
              suffix="日"
              hint="公的な目安は最低3日、できれば7日"
              defaultValue={value("targetDays")}
              error={state.errors.targetDays}
            />
          </div>
        </section>

        <section className="flex flex-col gap-3 rounded-xl border px-4 py-4">
          <div>
            <h2 className="text-sm font-semibold">1人1日あたりの必要量</h2>
            <p className="text-muted-foreground text-xs">
              区分ごとの必要量です。照明と電源は日数によらず「1人あたり何個」、
              熱源は人数によらず「1日あたり何回」で数えます。0を入れると、その区分は常に足りている扱いになります。
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <NumberField
              id="waterLitersPerPersonDay"
              label="飲料水"
              suffix="L / 人日"
              hint="飲用と調理をあわせた一般的な目安は3L"
              defaultValue={value("waterLitersPerPersonDay")}
              error={state.errors.waterLitersPerPersonDay}
            />
            <NumberField
              id="foodServingsPerPersonDay"
              label="食事"
              suffix="食 / 人日"
              hint="1食は商品の「1単位あたりの食数」で数えます"
              defaultValue={value("foodServingsPerPersonDay")}
              error={state.errors.foodServingsPerPersonDay}
            />
            <NumberField
              id="sanitationUsesPerPersonDay"
              label="携帯トイレ"
              suffix="回 / 人日"
              hint="衛生の必要量として数えます"
              defaultValue={value("sanitationUsesPerPersonDay")}
              error={state.errors.sanitationUsesPerPersonDay}
            />
            <NumberField
              id="lightingUnitsPerPerson"
              label="照明"
              suffix="個 / 人"
              hint="日数では増えません"
              defaultValue={value("lightingUnitsPerPerson")}
              error={state.errors.lightingUnitsPerPerson}
            />
            <NumberField
              id="powerUnitsPerPerson"
              label="電源"
              suffix="個 / 人"
              hint="日数では増えません"
              defaultValue={value("powerUnitsPerPerson")}
              error={state.errors.powerUnitsPerPerson}
            />
            <NumberField
              id="heatSourceUsesPerDay"
              label="熱源"
              suffix="回 / 日"
              hint="家族で1つの火を使う想定のため、人数では増えません"
              defaultValue={value("heatSourceUsesPerDay")}
              error={state.errors.heatSourceUsesPerDay}
            />
          </div>
        </section>

        <section className="flex flex-col gap-3 rounded-xl border px-4 py-4">
          <div>
            <h2 className="text-sm font-semibold">何を数えるか</h2>
            <p className="text-muted-foreground text-xs">
              既定では、非常時に使えるか確かでない在庫を数えません。含めるときはここで明示します。
            </p>
          </div>

          <CheckField
            id="includeChilled"
            defaultChecked={checked("includeChilled")}
            label="冷蔵の在庫も防災の日数に含める"
            hint="停電すると数時間で使えなくなります。含めると日数が実際より長く出ます。"
          />
          <CheckField
            id="includeFrozen"
            defaultChecked={checked("includeFrozen")}
            label="冷凍の在庫も防災の日数に含める"
            hint="同上。停電での持ち時間は保冷の状況で大きく変わります。"
          />
          <CheckField
            id="includeOpened"
            defaultChecked={checked("includeOpened")}
            label="開封済み（飲みかけ・使いかけ）の在庫も数える"
            hint="残量と衛生状態が分からないため、既定では数えません。"
          />
          <CheckField
            id="requireHeatSourceForHeating"
            defaultChecked={checked("requireHeatSourceForHeating")}
            label="加熱が要る食料は、熱源の在庫があるときだけ数える"
            hint="外すと、火が無くても食べられる前提で数えます。"
          />
          <CheckField
            id="requireWaterForRehydration"
            defaultChecked={checked("requireWaterForRehydration")}
            label="水が要る食料は、飲料水の在庫があるときだけ数える"
            hint="アルファ米・カップ麺のように、水が無いと食べられないもの。"
          />

          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            期限切れ・期限が未入力の在庫は、設定にかかわらず数えません（過大評価を避けるため）。
          </p>
        </section>

        <p className="text-muted-foreground flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
          <span>判定のルール版</span>
          <code className="text-foreground">{ruleVersion}</code>
          <span>
            この版で判定した結果は、同じ在庫と基準であとから再現できます。
            {isDefault ? "この家庭ではまだ基準を保存しておらず、既定値で判定しています。" : ""}
          </span>
        </p>
      </div>

      <div className="bg-background sticky bottom-0 mt-auto flex gap-2 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6">
        <Button asChild variant="outline" className="h-11 flex-1">
          <Link href="/disaster">防災ストックへ戻る</Link>
        </Button>
        <Button type="submit" className="h-11 flex-1" disabled={pending}>
          {pending ? "保存中…" : "保存"}
        </Button>
      </div>
    </form>
  );
}

function NumberField({
  id,
  label,
  suffix,
  hint,
  defaultValue,
  error,
}: {
  id: string;
  label: string;
  suffix: string;
  hint: string;
  defaultValue: string;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs font-semibold">
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          name={id}
          inputMode="decimal"
          defaultValue={defaultValue}
          required
          className="h-11 w-24 text-right text-base tabular-nums"
        />
        <span className="text-muted-foreground text-sm">{suffix}</span>
      </div>
      {error ? (
        <p role="alert" className="text-destructive text-xs font-semibold">
          {error}
        </p>
      ) : (
        <p className="text-muted-foreground text-xs">{hint}</p>
      )}
    </div>
  );
}

function CheckField({
  id,
  label,
  hint,
  defaultChecked,
}: {
  id: string;
  label: string;
  hint: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" name={id} defaultChecked={defaultChecked} className="mt-0.5 size-4" />
      <span>
        {label}
        <span className="text-muted-foreground block text-xs">{hint}</span>
      </span>
    </label>
  );
}
