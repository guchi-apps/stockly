"use server";

/**
 * 防災の基準（#7）を保存するServer Action。
 *
 * ここは「フォームの値を読む → `settings.ts`を呼ぶ → 画面へ戻す」だけを担い、
 * 入力の検証は`src/lib/disaster/rules.ts`の`parseDisasterPlanForm()`が持つ。
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { userFacingMessage, withParams, rawInput } from "@/app/(app)/action-result";
import type { InventoryFormState } from "@/app/(app)/form-state";
import { parseDisasterPlanForm } from "@/lib/disaster/rules";
import { saveDisasterPlanSettings } from "@/lib/disaster/settings";
import { requireInventoryContextForAction } from "@/lib/inventory/context";

export async function saveDisasterPlanAction(
  _prevState: InventoryFormState,
  formData: FormData,
): Promise<InventoryFormState> {
  const ctx = await requireInventoryContextForAction();
  const input = rawInput(formData);

  const parsed = parseDisasterPlanForm(input);
  if (!parsed.ok) return { errors: parsed.errors, values: input };

  try {
    await saveDisasterPlanSettings(ctx, parsed.value);
  } catch (error) {
    return { errors: { form: userFacingMessage(error) }, values: input };
  }

  revalidatePath("/disaster");
  revalidatePath("/disaster/settings");
  redirect(withParams("/disaster/settings", { notice: "防災の基準を保存しました。" }));
}
