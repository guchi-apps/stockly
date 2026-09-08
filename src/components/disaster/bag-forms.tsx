"use client";

import { useActionState } from "react";

import { EMPTY_FORM_STATE, type InventoryFormState } from "@/app/(app)/form-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_BAG_PEOPLE_COUNT,
  MAX_BAG_TARGET_DAYS,
  MAX_INSPECTION_INTERVAL_DAYS,
  MAX_INSPECTION_NOTE_LENGTH,
} from "@/lib/disaster/bag";

/**
 * 防災バッグの点検を記録するフォームと、バッグの基準のフォーム（#8）。
 *
 * どちらも`useActionState`で欄ごとのエラーを受け取り、送信された値をそのまま戻す
 * （打ち直しにさせない）。`plan-settings-form.tsx`と同じ作りにしてある。
 *
 * **点検日の既定は今日で、未来の日付は送っても弾かれる。** 「見た」ことの記録なので、
 * まだ見ていない日を入れられると次回の予定がそのぶん先送りされる（`parseBagInspectionForm`）。
 */

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-destructive text-xs">
      {message}
    </p>
  );
}

function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm"
    >
      {message}
    </p>
  );
}

export function BagInspectionForm({
  action,
  storageLocationId,
  today,
}: {
  action: (state: InventoryFormState, formData: FormData) => Promise<InventoryFormState>;
  storageLocationId: string;
  /** `<input type="date">`に入れる今日（`toTokyoDateInput()`の形）。 */
  today: string;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_FORM_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-3 px-4 py-4 md:px-6">
      <input type="hidden" name="storageLocationId" value={storageLocationId} />
      <FormError message={state.errors.form} />

      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <div className="flex flex-col gap-1.5 md:w-44">
          <Label htmlFor="inspectedOn">点検日</Label>
          <Input
            id="inspectedOn"
            name="inspectedOn"
            type="date"
            max={today}
            defaultValue={state.values.inspectedOn ?? today}
            aria-invalid={state.errors.inspectedOn ? true : undefined}
          />
          <FieldError message={state.errors.inspectedOn} />
        </div>

        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="note">メモ（任意）</Label>
          <Textarea
            id="note"
            name="note"
            rows={2}
            maxLength={MAX_INSPECTION_NOTE_LENGTH}
            placeholder="ウェットティッシュの期限を確認して入力した、など"
            defaultValue={state.values.note ?? ""}
            aria-invalid={state.errors.note ? true : undefined}
          />
          <FieldError message={state.errors.note} />
        </div>

        <Button type="submit" disabled={pending} className="md:self-end">
          {pending ? "記録しています…" : "点検を記録する"}
        </Button>
      </div>

      <p className="text-muted-foreground text-[11px] leading-relaxed">
        記録すると、そのときの中身の件数（期限切れ・期限間近・期限が要確認）が一緒に残り、
        次回の点検予定が決まります。充足の数字そのものは保存せず、開くたびに在庫から出し直します。
      </p>
    </form>
  );
}

export interface BagPlanFormInitial {
  peopleCount: string;
  targetDays: string;
  inspectionIntervalDays: string;
}

export function BagPlanForm({
  action,
  storageLocationId,
  initial,
  isDefault,
}: {
  action: (state: InventoryFormState, formData: FormData) => Promise<InventoryFormState>;
  storageLocationId: string;
  initial: BagPlanFormInitial;
  isDefault: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_FORM_STATE);
  const value = (key: keyof BagPlanFormInitial): string => state.values[key] ?? initial[key];

  return (
    <form action={formAction} className="flex flex-col gap-3 px-4 py-4 md:px-6">
      <input type="hidden" name="storageLocationId" value={storageLocationId} />
      <FormError message={state.errors.form} />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="peopleCount">何人ぶん</Label>
          <Input
            id="peopleCount"
            name="peopleCount"
            inputMode="numeric"
            max={MAX_BAG_PEOPLE_COUNT}
            defaultValue={value("peopleCount")}
            aria-invalid={state.errors.peopleCount ? true : undefined}
          />
          <FieldError message={state.errors.peopleCount} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="targetDays">何日ぶん</Label>
          <Input
            id="targetDays"
            name="targetDays"
            inputMode="numeric"
            max={MAX_BAG_TARGET_DAYS}
            defaultValue={value("targetDays")}
            aria-invalid={state.errors.targetDays ? true : undefined}
          />
          <FieldError message={state.errors.targetDays} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="inspectionIntervalDays">点検の間隔（日）</Label>
          <Input
            id="inspectionIntervalDays"
            name="inspectionIntervalDays"
            inputMode="numeric"
            max={MAX_INSPECTION_INTERVAL_DAYS}
            defaultValue={value("inspectionIntervalDays")}
            aria-invalid={state.errors.inspectionIntervalDays ? true : undefined}
          />
          <FieldError message={state.errors.inspectionIntervalDays} />
        </div>
      </div>

      <p className="text-muted-foreground text-[11px] leading-relaxed">
        {isDefault
          ? "まだ保存していないため、既定（1人・1日ぶん・180日ごと）で判定しています。"
          : "このバッグだけの目標です。"}
        1人1日あたりの必要量（水3L など）と「冷蔵を数えるか」は
        <b className="text-foreground font-semibold">家庭全体の基準</b>
        をそのまま使います。持ち出し袋に家全体の3日ぶんを求めるとどのバッグも常に不足になるため、
        人数と日数だけをここで変えられるようにしています。
      </p>

      <div>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "保存しています…" : "この基準で保存する"}
        </Button>
      </div>
    </form>
  );
}
