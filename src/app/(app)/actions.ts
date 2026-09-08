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

import { parseBarcode, parseSymbology } from "@/lib/barcode/code";
import { resolveInternalPath } from "@/lib/auth/internal-path";
import { requireInventoryContextForAction } from "@/lib/inventory/context";
import {
  InventoryInputError,
  RECORDABLE_TYPE_LABELS,
  parseExpirySettingsForm,
  parseOperationId,
  parseRecordForm,
  parseStockLotForm,
  parseStorageLocationForm,
} from "@/lib/inventory/operations";
import {
  InventoryConflictError,
  InventoryNotFoundError,
  createDefaultStorageLocations,
  createStockLot,
  createStorageLocation,
  createStoragePosition,
  deleteStorageLocation,
  deleteStoragePosition,
  dismissBarcodeMismatch,
  rebindBarcode,
  recordTransaction,
  renameStorageLocation,
  reverseTransaction,
  unlinkBarcode,
  updateStockLot,
  type BarcodeLinkInput,
} from "@/lib/inventory/service";
import { saveExpirySettings } from "@/lib/inventory/settings";
import {
  countUnreadNotifications,
  markNotificationsRead,
  runExpiryCheckForHousehold,
} from "@/lib/notifications/inbox";

import type { InventoryFormState } from "./form-state";

function str(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function rawInput(formData: FormData): Record<string, string> {
  const input: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") input[key] = value;
  }
  return input;
}

/**
 * 利用者に見せてよいエラーか。
 *
 * 想定外の例外はここで握り潰さず、そのまま投げてNext.jsのエラー画面に出す。
 * 「操作できませんでした」とだけ表示して原因を消すと、追えなくなる。
 */
function userFacingMessage(error: unknown): string {
  if (
    error instanceof InventoryInputError ||
    error instanceof InventoryConflictError ||
    error instanceof InventoryNotFoundError
  ) {
    return error.message;
  }
  throw error;
}

function withParams(path: string, params: { notice?: string; error?: string }): string {
  const search = new URLSearchParams();
  if (params.notice) search.set("notice", params.notice);
  if (params.error) search.set("error", params.error);
  const query = search.toString();
  return query ? `${path}${path.includes("?") ? "&" : "?"}${query}` : path;
}

/** 戻り先はフォームから渡ってくるため、必ず内部パスへ正す（open redirectの防止）。 */
function backPath(formData: FormData, fallback: string): string {
  const value = str(formData, "redirectTo");
  const path = resolveInternalPath(value);
  return path === "/" && value !== "/" ? fallback : path;
}

function revalidateInventory(): void {
  revalidatePath("/inventory");
  revalidatePath("/expiry");
  revalidatePath("/history");
  revalidatePath("/storage");
  // 登録するとコードの利用回数と紐付けも動く（#9）。
  revalidatePath("/inventory/scan");
  revalidatePath("/barcodes");
}

/**
 * 登録フォームに埋まっているバーコードを読む。コードが無ければ`null`。
 *
 * 値そのものは`parseBarcode()`で正し直す。フォームの`hidden`は書き換えられるため、
 * 画面が入れた値をそのままDBの一意キーに使わない。
 */
function barcodeFromForm(formData: FormData): BarcodeLinkInput | null {
  const raw = str(formData, "code");
  if (raw === "") return null;

  const parsed = parseBarcode(raw);
  return {
    code: parsed.code,
    symbology: parseSymbology(str(formData, "symbology")) ?? parsed.symbology,
    source: str(formData, "barcodeSource") === "scan" ? "SCAN" : "MANUAL",
    // 商品名を変えたときにコードを付け替えてよいか。画面が既定でチェックを入れている。
    rebind: str(formData, "rebindBarcode") === "on",
  };
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
      barcode: barcodeFromForm(formData),
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

// ---------------------------------------------------------------------------
// バーコードの紐付け（#9）
// ---------------------------------------------------------------------------

/** コードを別の商品へ付け替える。誤って紐付いたコードを直す。 */
export async function rebindBarcodeAction(formData: FormData): Promise<void> {
  const ctx = await requireInventoryContextForAction();
  let outcome: { notice?: string; error?: string };

  try {
    await rebindBarcode(ctx, {
      barcodeId: str(formData, "barcodeId"),
      productId: str(formData, "productId"),
    });
    outcome = { notice: "バーコードの紐付けを付け替えました。" };
  } catch (error) {
    outcome = { error: userFacingMessage(error) };
  }

  revalidateInventory();
  redirect(withParams("/barcodes", outcome));
}

/** コードの紐付けを外す。商品と在庫はそのまま残る。 */
export async function unlinkBarcodeAction(formData: FormData): Promise<void> {
  const ctx = await requireInventoryContextForAction();
  let outcome: { notice?: string; error?: string };

  try {
    const { code } = await unlinkBarcode(ctx, { barcodeId: str(formData, "barcodeId") });
    outcome = { notice: `${code} の紐付けを外しました。次に読み取ると未登録として扱われます。` };
  } catch (error) {
    outcome = { error: userFacingMessage(error) };
  }

  revalidateInventory();
  redirect(withParams("/barcodes", outcome));
}

/** 誤紐付けの疑いを「そのままでよい」と決める。 */
export async function dismissBarcodeMismatchAction(formData: FormData): Promise<void> {
  const ctx = await requireInventoryContextForAction();
  let outcome: { notice?: string; error?: string };

  try {
    await dismissBarcodeMismatch(ctx, { barcodeId: str(formData, "barcodeId") });
    outcome = { notice: "この紐付けはそのままにしました。" };
  } catch (error) {
    outcome = { error: userFacingMessage(error) };
  }

  revalidateInventory();
  redirect(withParams("/barcodes", outcome));
}

// ---------------------------------------------------------------------------
// 期限の設定と通知
// ---------------------------------------------------------------------------

export async function saveExpirySettingsAction(
  _prevState: InventoryFormState,
  formData: FormData,
): Promise<InventoryFormState> {
  const ctx = await requireInventoryContextForAction();
  const input = rawInput(formData);

  const parsed = parseExpirySettingsForm(input);
  if (!parsed.ok) return { errors: parsed.errors, values: input };

  try {
    await saveExpirySettings(ctx, parsed.value);
  } catch (error) {
    return { errors: { form: userFacingMessage(error) }, values: input };
  }

  revalidateInventory();
  redirect(withParams("/expiry/settings", { notice: "期限の設定を保存しました。" }));
}

/**
 * いま期限を確認して、必要なら通知を作る（cronと同じ処理を手で1回動かす）。
 *
 * 前回から状況が変わっていなければ何も送らない。**その場合も「送らなかった」と伝える。**
 * 押しても何も起きないように見えると、通知そのものが壊れているのか、送るものが無いのかが
 * 利用者に区別できない。
 */
export async function runExpiryCheckAction(formData: FormData): Promise<void> {
  const back = backPath(formData, "/expiry");
  const ctx = await requireInventoryContextForAction();
  let outcome: { notice?: string; error?: string };

  try {
    const summary = await runExpiryCheckForHousehold(ctx);
    const skipped = summary.details[0]?.skipped ?? null;

    outcome =
      summary.failed > 0
        ? { error: "通知を送れませんでした。時間をおいてもう一度お試しください。" }
        : summary.sent > 0
          ? { notice: `期限の通知を${summary.sent}件送りました。` }
          : skipped === "notify-disabled"
            ? { notice: "通知は設定でオフになっています。" }
            : skipped === "no-targets"
              ? { notice: "期限切れ・期限間近の在庫はありませんでした。" }
              : { notice: "前回から変わりがないため、通知は送っていません。" };
  } catch (error) {
    outcome = { error: userFacingMessage(error) };
  }

  revalidateInventory();
  redirect(withParams(back, outcome));
}

export async function markNotificationsReadAction(formData: FormData): Promise<void> {
  const back = backPath(formData, "/expiry");
  const ctx = await requireInventoryContextForAction();
  let outcome: { notice?: string; error?: string };

  try {
    const unread = await countUnreadNotifications(ctx);
    await markNotificationsRead(ctx);
    outcome = { notice: unread > 0 ? `${unread}件を既読にしました。` : "未読のお知らせはありません。" };
  } catch (error) {
    outcome = { error: userFacingMessage(error) };
  }

  revalidateInventory();
  redirect(withParams(back, outcome));
}
