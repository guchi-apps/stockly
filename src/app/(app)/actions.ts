"use server";

/**
 * 在庫の画面から呼ぶServer Action。
 *
 * ここは「フォームの値を読む → `service.ts`を呼ぶ → 画面へ戻す」だけを担い、
 * 家庭の境界・数量の計算・二重送信の判定は`service.ts`と`operations.ts`が持つ。
 *
 * 結果の伝え方は2通りある。
 *
 * - 押すだけの操作（±1・取消・保管場所の削除など）は、戻り先へ`?notice=`／`?error=`を付けて
 *   リダイレクトする。クライアント側のJSが無くても結果が出る
 * - 入力欄のあるフォーム（在庫の登録・編集）は`useActionState`で状態を返し、
 *   エラーになった欄の下にメッセージを出す。入力した値も一緒に返して、打ち直しにさせない
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireInventoryContextForAction } from "@/lib/inventory/context";
import {
  InventoryInputError,
  RECORDABLE_TYPE_LABELS,
  parseOperationId,
  parseRecordForm,
  parseStockLotForm,
  parseStorageLocationForm,
} from "@/lib/inventory/operations";
import {
  createDefaultStorageLocations,
  createStockLot,
  createStorageLocation,
  createStoragePosition,
  deleteStorageLocation,
  deleteStoragePosition,
  recordTransaction,
  renameStorageLocation,
  reverseTransaction,
  updateStockLot,
} from "@/lib/inventory/service";

import { backPath, rawInput, str, userFacingMessage, withParams } from "./action-result";
import type { InventoryFormState } from "./form-state";

function revalidateInventory(): void {
  revalidatePath("/inventory");
  revalidatePath("/history");
  revalidatePath("/storage");
}

// ---------------------------------------------------------------------------
// 入出庫の記録と取消
// ---------------------------------------------------------------------------

/** 補充・消費・廃棄を1件記録する。一覧の±1ボタンと詳細の操作ボタンが使う。 */
export async function recordTransactionAction(formData: FormData): Promise<void> {
  const back = backPath(formData, "/inventory");
  const ctx = await requireInventoryContextForAction();
  let outcome: { notice?: string; error?: string };

  const parsed = parseRecordForm(rawInput(formData));
  if (!parsed.ok) {
    outcome = { error: Object.values(parsed.errors)[0] };
  } else {
    try {
      const result = await recordTransaction(ctx, {
        operationId: parsed.value.operationId,
        lotId: str(formData, "lotId"),
        type: parsed.value.type,
        amount: parsed.value.amount,
        note: parsed.value.note,
      });

      outcome =
        result.status === "duplicate"
          ? { notice: "この操作は記録済みです（数量は二重に動いていません）。" }
          : { notice: `${RECORDABLE_TYPE_LABELS[parsed.value.type]}を記録しました。` };
    } catch (error) {
      outcome = { error: userFacingMessage(error) };
    }
  }

  revalidateInventory();
  redirect(withParams(back, outcome));
}

/** 履歴を1件取り消す。直前の操作でなくても取り消せる。 */
export async function reverseTransactionAction(formData: FormData): Promise<void> {
  const back = backPath(formData, "/inventory");
  const ctx = await requireInventoryContextForAction();
  let outcome: { notice?: string; error?: string };

  try {
    const result = await reverseTransaction(ctx, {
      operationId: parseOperationId(str(formData, "operationId")),
      transactionId: str(formData, "transactionId"),
    });

    outcome =
      result.status === "duplicate"
        ? { notice: "この取消は記録済みです（数量は二重に戻っていません）。" }
        : { notice: "記録を取り消し、数量を戻しました。" };
  } catch (error) {
    outcome = { error: userFacingMessage(error) };
  }

  revalidateInventory();
  redirect(withParams(back, outcome));
}

// ---------------------------------------------------------------------------
// 在庫の登録・編集
// ---------------------------------------------------------------------------

export async function createStockLotAction(
  _prevState: InventoryFormState,
  formData: FormData,
): Promise<InventoryFormState> {
  const ctx = await requireInventoryContextForAction();
  const input = rawInput(formData);

  const parsed = parseStockLotForm(input);
  if (!parsed.ok) return { errors: parsed.errors, values: input };

  let lotId: string;
  try {
    const result = await createStockLot(ctx, {
      ...parsed.value,
      operationId: parseOperationId(str(formData, "operationId")),
    });
    lotId = result.lotId;
  } catch (error) {
    if (error instanceof InventoryInputError) {
      return { errors: { [error.field]: error.message }, values: input };
    }
    return { errors: { form: userFacingMessage(error) }, values: input };
  }

  revalidateInventory();
  redirect(withParams(`/inventory/${lotId}`, { notice: "在庫を登録しました。" }));
}

export async function updateStockLotAction(
  _prevState: InventoryFormState,
  formData: FormData,
): Promise<InventoryFormState> {
  const ctx = await requireInventoryContextForAction();
  const input = rawInput(formData);

  const parsed = parseStockLotForm(input);
  if (!parsed.ok) return { errors: parsed.errors, values: input };

  const lotId = str(formData, "lotId");
  try {
    const expectedUpdatedAt = new Date(str(formData, "expectedUpdatedAt"));
    if (Number.isNaN(expectedUpdatedAt.getTime())) {
      throw new InventoryInputError("form", "画面を開き直して、もう一度お試しください。");
    }

    await updateStockLot(ctx, {
      operationId: parseOperationId(str(formData, "operationId")),
      lotId,
      expectedUpdatedAt,
      productName: parsed.value.productName,
      categoryName: parsed.value.categoryName,
      amount: parsed.value.amount,
      storageLocationId: parsed.value.storageLocationId,
      storagePositionId: parsed.value.storagePositionId,
      expiryKind: parsed.value.expiryKind,
      expiryDate: parsed.value.expiryDate,
      opened: parsed.value.opened,
      note: parsed.value.note,
    });
  } catch (error) {
    if (error instanceof InventoryInputError) {
      return { errors: { [error.field]: error.message }, values: input };
    }
    return { errors: { form: userFacingMessage(error) }, values: input };
  }

  revalidateInventory();
  redirect(withParams(`/inventory/${lotId}`, { notice: "在庫を更新しました。" }));
}

// ---------------------------------------------------------------------------
// 保管場所と詳細位置
// ---------------------------------------------------------------------------

export async function createStorageLocationAction(
  _prevState: InventoryFormState,
  formData: FormData,
): Promise<InventoryFormState> {
  const ctx = await requireInventoryContextForAction();
  const input = rawInput(formData);

  const parsed = parseStorageLocationForm(input);
  if (!parsed.ok) return { errors: parsed.errors, values: input };

  try {
    await createStorageLocation(ctx, parsed.value);
  } catch (error) {
    if (error instanceof InventoryInputError) {
      return { errors: { [error.field]: error.message }, values: input };
    }
    return { errors: { form: userFacingMessage(error) }, values: input };
  }

  revalidateInventory();
  redirect(withParams("/storage", { notice: `「${parsed.value.name}」を追加しました。` }));
}

/** 冷蔵庫・冷凍庫・食品棚・防災バッグ・洗面所をまとめて作る（空状態からの立ち上げ）。 */
export async function createDefaultStorageLocationsAction(): Promise<void> {
  const ctx = await requireInventoryContextForAction();
  let outcome: { notice?: string; error?: string };

  try {
    const created = await createDefaultStorageLocations(ctx);
    outcome = {
      notice: created > 0 ? `保管場所を${created}件作りました。` : "追加する保管場所はありませんでした。",
    };
  } catch (error) {
    outcome = { error: userFacingMessage(error) };
  }

  revalidateInventory();
  redirect(withParams("/storage", outcome));
}

export async function createStoragePositionAction(formData: FormData): Promise<void> {
  const ctx = await requireInventoryContextForAction();
  let outcome: { notice?: string; error?: string };

  try {
    await createStoragePosition(ctx, {
      storageLocationId: str(formData, "storageLocationId"),
      name: str(formData, "name"),
    });
    outcome = { notice: "詳細位置を追加しました。" };
  } catch (error) {
    outcome = { error: userFacingMessage(error) };
  }

  revalidateInventory();
  redirect(withParams("/storage", outcome));
}

export async function renameStorageLocationAction(formData: FormData): Promise<void> {
  const ctx = await requireInventoryContextForAction();
  let outcome: { notice?: string; error?: string };

  try {
    await renameStorageLocation(ctx, {
      storageLocationId: str(formData, "storageLocationId"),
      name: str(formData, "name"),
    });
    outcome = { notice: "保管場所の名前を変えました。" };
  } catch (error) {
    outcome = { error: userFacingMessage(error) };
  }

  revalidateInventory();
  redirect(withParams("/storage", outcome));
}

export async function deleteStorageLocationAction(formData: FormData): Promise<void> {
  const ctx = await requireInventoryContextForAction();
  let outcome: { notice?: string; error?: string };

  try {
    await deleteStorageLocation(ctx, { storageLocationId: str(formData, "storageLocationId") });
    outcome = { notice: "保管場所を削除しました。" };
  } catch (error) {
    outcome = { error: userFacingMessage(error) };
  }

  revalidateInventory();
  redirect(withParams("/storage", outcome));
}

export async function deleteStoragePositionAction(formData: FormData): Promise<void> {
  const ctx = await requireInventoryContextForAction();
  let outcome: { notice?: string; error?: string };

  try {
    await deleteStoragePosition(ctx, { storagePositionId: str(formData, "storagePositionId") });
    outcome = { notice: "詳細位置を削除しました。" };
  } catch (error) {
    outcome = { error: userFacingMessage(error) };
  }

  revalidateInventory();
  redirect(withParams("/storage", outcome));
}
