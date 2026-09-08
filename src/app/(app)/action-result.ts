/**
 * Server Actionが結果を画面へ返すための共通の道具。
 *
 * `actions.ts`は`"use server"`のため非同期関数以外をexportできない。複数の`actions.ts`
 * （在庫・補充）が同じ処理を持たないよう、ここへ置く。**特に`backPath()`は
 * open redirectの防止そのものなので、画面ごとに書き写さない。**
 */
import { resolveInternalPathOr } from "@/lib/auth/internal-path";
import { InventoryInputError } from "@/lib/inventory/operations";
import { InventoryConflictError, InventoryNotFoundError } from "@/lib/inventory/service";

export function str(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export function rawInput(formData: FormData): Record<string, string> {
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
export function userFacingMessage(error: unknown): string {
  if (
    error instanceof InventoryInputError ||
    error instanceof InventoryConflictError ||
    error instanceof InventoryNotFoundError
  ) {
    return error.message;
  }
  throw error;
}

export function withParams(path: string, params: { notice?: string; error?: string }): string {
  const search = new URLSearchParams();
  if (params.notice) search.set("notice", params.notice);
  if (params.error) search.set("error", params.error);
  const query = search.toString();
  return query ? `${path}${path.includes("?") ? "&" : "?"}${query}` : path;
}

/** 戻り先はフォームから渡ってくるため、必ず内部パスへ正す（open redirectの防止）。 */
export function backPath(formData: FormData, fallback: string): string {
  return resolveInternalPathOr(str(formData, "redirectTo"), fallback);
}
