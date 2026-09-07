import type { FieldErrors } from "@/lib/inventory/operations";

/**
 * 入力欄のあるフォームが`useActionState`で受け取る状態。
 *
 * Server Actionのファイル（`actions.ts`）は`"use server"`のため、非同期関数以外を
 * exportできない。型と初期値はここへ置く。
 */
export interface InventoryFormState {
  readonly errors: FieldErrors;
  /** 打ち直しにさせないための、送信された値。 */
  readonly values: Record<string, string>;
}

export const EMPTY_FORM_STATE: InventoryFormState = { errors: {}, values: {} };
