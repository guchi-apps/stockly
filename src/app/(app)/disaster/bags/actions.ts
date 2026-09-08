"use server";

/**
 * 防災バッグの点検（#8）のServer Action。
 *
 * ここは「フォームの値を読む → `bag-queries.ts`を呼ぶ → 画面へ戻す」だけを担い、
 * 入力の検証は`src/lib/disaster/bag.ts`の純関数が持つ（`/disaster`の基準と同じ形）。
 *
 * **点検時の件数はここでは受け取らない。** 画面が出していた数字をそのまま送ると、
 * 開いてから記録するまでに動いた在庫が記録に残らないため、`recordBagInspection()`が
 * 保存の直前に数え直す。
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { userFacingMessage, withParams, rawInput } from "@/app/(app)/action-result";
import type { InventoryFormState } from "@/app/(app)/form-state";
import { parseBagInspectionForm, parseDisasterBagPlanForm } from "@/lib/disaster/bag";
import { recordBagInspection, saveDisasterBagPlan } from "@/lib/disaster/bag-queries";
import { requireInventoryContextForAction } from "@/lib/inventory/context";
import { tokyoToday } from "@/lib/time/tokyo";

/** フォームに埋めた保管場所id。無ければ画面を開き直してもらう。 */
function storageLocationIdOf(input: Record<string, string | undefined | null>): string | null {
  const value = (input.storageLocationId ?? "").trim();
  return value === "" ? null : value;
}

export async function recordBagInspectionAction(
  _prevState: InventoryFormState,
  formData: FormData,
): Promise<InventoryFormState> {
  const ctx = await requireInventoryContextForAction();
  const input = rawInput(formData);

  const storageLocationId = storageLocationIdOf(input);
  if (!storageLocationId) {
    return { errors: { form: "防災バッグを特定できませんでした。画面を開き直してください。" }, values: input };
  }

  const parsed = parseBagInspectionForm(input, tokyoToday());
  if (!parsed.ok) return { errors: parsed.errors, values: input };

  try {
    await recordBagInspection(ctx, storageLocationId, parsed.value);
  } catch (error) {
    return { errors: { form: userFacingMessage(error) }, values: input };
  }

  revalidatePath("/disaster");
  revalidatePath("/disaster/bags");
  revalidatePath(`/disaster/bags/${storageLocationId}`);
  redirect(
    withParams(`/disaster/bags/${storageLocationId}`, { notice: "点検を記録しました。" }),
  );
}

export async function saveBagPlanAction(
  _prevState: InventoryFormState,
  formData: FormData,
): Promise<InventoryFormState> {
  const ctx = await requireInventoryContextForAction();
  const input = rawInput(formData);

  const storageLocationId = storageLocationIdOf(input);
  if (!storageLocationId) {
    return { errors: { form: "防災バッグを特定できませんでした。画面を開き直してください。" }, values: input };
  }

  const parsed = parseDisasterBagPlanForm(input);
  if (!parsed.ok) return { errors: parsed.errors, values: input };

  try {
    await saveDisasterBagPlan(ctx, storageLocationId, parsed.value);
  } catch (error) {
    return { errors: { form: userFacingMessage(error) }, values: input };
  }

  revalidatePath("/disaster");
  revalidatePath("/disaster/bags");
  revalidatePath(`/disaster/bags/${storageLocationId}`);
  redirect(
    withParams(`/disaster/bags/${storageLocationId}`, { notice: "このバッグの基準を保存しました。" }),
  );
}
