"use server";

/**
 * 補充の画面から呼ぶServer Action。
 *
 * 在庫側（`src/app/(app)/actions.ts`）と同じく、ここは「フォームの値を読む →
 * `service.ts`を呼ぶ → 画面へ戻す」だけを担う。判定・境界・Notionとのやり取りは
 * `src/lib/replenishment/`と`src/lib/notion/`が持つ。
 *
 * **在庫は一切変えない。** 補充候補を送るのは「買い物リストへ載せる」ことであって、
 * 「買った」ことではない。
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireInventoryContextForAction } from "@/lib/inventory/context";
import {
  parseReplenishmentRuleAmounts,
  parseReplenishmentRuleForm,
  parseSelectedRuleIds,
} from "@/lib/replenishment/rules";
import {
  createReplenishmentRule,
  deleteReplenishmentRule,
  deleteShoppingListEntry,
  resendShoppingListEntry,
  sendCandidatesToNotion,
  setReplenishmentRuleEnabled,
  updateReplenishmentRuleAmounts,
  type SendSummary,
} from "@/lib/replenishment/service";

import { backPath, rawInput, str, userFacingMessage, withParams } from "../action-result";
import type { InventoryFormState } from "../form-state";

function revalidateReplenishment(): void {
  revalidatePath("/replenishment");
  revalidatePath("/replenishment/rules");
}

// ---------------------------------------------------------------------------
// 補充基準
// ---------------------------------------------------------------------------

export async function createReplenishmentRuleAction(
  _prevState: InventoryFormState,
  formData: FormData,
): Promise<InventoryFormState> {
  const ctx = await requireInventoryContextForAction();
  const input = rawInput(formData);

  const parsed = parseReplenishmentRuleForm(input);
  if (!parsed.ok) return { errors: parsed.errors, values: input };

  try {
    await createReplenishmentRule(ctx, parsed.value);
  } catch (error) {
    return { errors: { form: userFacingMessage(error) }, values: input };
  }

  revalidateReplenishment();
  redirect(withParams("/replenishment/rules", { notice: "補充基準を追加しました。" }));
}

export async function updateReplenishmentRuleAction(formData: FormData): Promise<void> {
  const ctx = await requireInventoryContextForAction();
  let outcome: { notice?: string; error?: string };

  const parsed = parseReplenishmentRuleAmounts(rawInput(formData));
  if (!parsed.ok) {
    outcome = { error: Object.values(parsed.errors)[0] };
  } else {
    try {
      await updateReplenishmentRuleAmounts(ctx, {
        ruleId: str(formData, "ruleId"),
        thresholdAmount: parsed.value.thresholdAmount,
        targetAmount: parsed.value.targetAmount,
      });
      outcome = { notice: "補充基準を更新しました。" };
    } catch (error) {
      outcome = { error: userFacingMessage(error) };
    }
  }

  revalidateReplenishment();
  redirect(withParams("/replenishment/rules", outcome));
}

/** 基準を消さずに候補から外す（季節ものなど、しばらく買わないもの向け）。 */
export async function toggleReplenishmentRuleAction(formData: FormData): Promise<void> {
  const ctx = await requireInventoryContextForAction();
  const enabled = str(formData, "enabled") === "on";
  let outcome: { notice?: string; error?: string };

  try {
    await setReplenishmentRuleEnabled(ctx, { ruleId: str(formData, "ruleId"), enabled });
    outcome = { notice: enabled ? "候補に出すようにしました。" : "候補から外しました。" };
  } catch (error) {
    outcome = { error: userFacingMessage(error) };
  }

  revalidateReplenishment();
  redirect(withParams("/replenishment/rules", outcome));
}

export async function deleteReplenishmentRuleAction(formData: FormData): Promise<void> {
  const ctx = await requireInventoryContextForAction();
  let outcome: { notice?: string; error?: string };

  try {
    await deleteReplenishmentRule(ctx, { ruleId: str(formData, "ruleId") });
    outcome = { notice: "補充基準を削除しました。" };
  } catch (error) {
    outcome = { error: userFacingMessage(error) };
  }

  revalidateReplenishment();
  redirect(withParams("/replenishment/rules", outcome));
}

// ---------------------------------------------------------------------------
// Notionへの送信
// ---------------------------------------------------------------------------

/** 選んだ候補をまとめて送る。1件でも送れたものがあれば、その結果は残る。 */
export async function sendCandidatesAction(formData: FormData): Promise<void> {
  const back = backPath(formData, "/replenishment");
  const ctx = await requireInventoryContextForAction();
  let outcome: { notice?: string; error?: string };

  const ids = formData.getAll("ruleIds").filter((value): value is string => typeof value === "string");
  const parsed = parseSelectedRuleIds(ids);

  if (!parsed.ok) {
    outcome = { error: Object.values(parsed.errors)[0] };
  } else {
    try {
      outcome = describeSendResult(await sendCandidatesToNotion(ctx, { ruleIds: parsed.value }));
    } catch (error) {
      outcome = { error: userFacingMessage(error) };
    }
  }

  revalidateReplenishment();
  redirect(withParams(back, outcome));
}

export async function resendShoppingListEntryAction(formData: FormData): Promise<void> {
  const back = backPath(formData, "/replenishment");
  const ctx = await requireInventoryContextForAction();
  let outcome: { notice?: string; error?: string };

  try {
    const { error } = await resendShoppingListEntry(ctx, { entryId: str(formData, "entryId") });
    // 送信済みならNotionの同じページを更新し、まだ送れていなければ作る。どちらでも
    // 「同じ候補の項目は増えない」ことだけが利用者に関係するので、そこを伝える。
    outcome = error ? { error } : { notice: "Notionへ送りました（同じ候補の項目は増えません）。" };
  } catch (error) {
    outcome = { error: userFacingMessage(error) };
  }

  revalidateReplenishment();
  redirect(withParams(back, outcome));
}

export async function deleteShoppingListEntryAction(formData: FormData): Promise<void> {
  const back = backPath(formData, "/replenishment");
  const ctx = await requireInventoryContextForAction();
  let outcome: { notice?: string; error?: string };

  try {
    await deleteShoppingListEntry(ctx, { entryId: str(formData, "entryId") });
    outcome = { notice: "送信記録を取り下げました（Notionの項目はそのままです）。" };
  } catch (error) {
    outcome = { error: userFacingMessage(error) };
  }

  revalidateReplenishment();
  redirect(withParams(back, outcome));
}

/**
 * 送信結果の伝え方。
 *
 * 一部だけ失敗することがあるため、成功件数と失敗件数を1つの文にまとめる。
 * 失敗があれば`error`側で出し、詳細（理由）は各行に残っている。
 */
function describeSendResult(summary: SendSummary): { notice?: string; error?: string } {
  const parts: string[] = [];
  if (summary.sent > 0) parts.push(`${summary.sent}件をNotionへ送りました`);
  if (summary.skipped > 0) parts.push(`${summary.skipped}件は送りませんでした（不足が解消・送信中）`);

  if (summary.failed > 0) {
    const head = parts.length > 0 ? `${parts.join("。")}。` : "";
    return { error: `${head}${summary.failed}件は送れませんでした: ${summary.firstError ?? ""}` };
  }
  return { notice: parts.length > 0 ? `${parts.join("。")}。` : "送る候補がありませんでした。" };
}
