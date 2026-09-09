/**
 * 家庭ごとの写真取込の設定（`IntakeSetting`）の読み書き（#10）。
 *
 * 行が無い家庭でも画面が成り立つよう、**読み取りは常に既定値で埋めて返す**
 * （`ExpirySetting`・`DisasterPlanSetting`と同じ形）。
 * **スキーマの`@default`とここの既定値は別々に書いてあるので、片方だけ変えないこと。**
 *
 * 家庭の境界は在庫と同じで、画面から呼ぶ関数は必ず`scopeToHousehold()`を通す。
 */
import { db } from "@/lib/db";
import { scopeToHousehold } from "@/lib/household/access";
import { householdMembershipStore } from "@/lib/household/store";

import { InventoryInputError, type ParseResult, type RawInput } from "../inventory/operations.ts";
import type { InventoryContext } from "../inventory/service.ts";

import { INTAKE_MODELS, toIntakeModel, type IntakeModelId } from "./config.ts";

/** 画面で選べる保存期間（日）。**0は「保存しない」。** */
export const IMAGE_RETENTION_CHOICES = [0, 7, 30, 90] as const;
export type ImageRetentionDays = (typeof IMAGE_RETENTION_CHOICES)[number];

export const IMAGE_RETENTION_LABELS: Readonly<Record<ImageRetentionDays, string>> = {
  0: "保存しない",
  7: "7日",
  30: "30日",
  90: "90日",
};

export interface IntakeSettingsFormValue {
  readonly imageRetentionDays: number;
  readonly sendProductNames: boolean;
  readonly monthlyRequestLimit: number;
  readonly monthlyCostLimitYen: number;
  readonly stopOnLimit: boolean;
  /** 空文字なら環境変数の既定モデルを使う。 */
  readonly model: string;
}

export interface IntakeSettings extends IntakeSettingsFormValue {
  /** まだ保存されていない（既定値のまま）か。画面の説明に使う。 */
  readonly isDefault: boolean;
}

export const DEFAULT_INTAKE_SETTINGS: IntakeSettings = {
  imageRetentionDays: 30,
  sendProductNames: false,
  monthlyRequestLimit: 100,
  monthlyCostLimitYen: 1000,
  stopOnLimit: true,
  model: "",
  isDefault: true,
};

/** 上限として受け付ける最大値。桁を打ち間違えたまま保存できてしまうのを防ぐ。 */
const MAX_MONTHLY_REQUESTS = 10_000;
const MAX_MONTHLY_COST_YEN = 100_000;

async function scope(ctx: InventoryContext): Promise<string> {
  const { householdId } = await scopeToHousehold(
    householdMembershipStore,
    ctx.userId,
    ctx.householdId,
  );
  return householdId;
}

/**
 * 家庭idだけで読む内部用。**すでに`scopeToHousehold()`を通した`householdId`にだけ使う。**
 * 画面・Server Actionからは`getIntakeSettings()`を使うこと。
 */
export async function readIntakeSettings(householdId: string): Promise<IntakeSettings> {
  const row = await db.intakeSetting.findUnique({
    where: { householdId },
    select: {
      imageRetentionDays: true,
      sendProductNames: true,
      monthlyRequestLimit: true,
      monthlyCostLimitYen: true,
      stopOnLimit: true,
      model: true,
    },
  });
  if (!row) return DEFAULT_INTAKE_SETTINGS;
  return {
    ...row,
    monthlyCostLimitYen: Number(row.monthlyCostLimitYen),
    isDefault: false,
  };
}

export async function getIntakeSettings(ctx: InventoryContext): Promise<IntakeSettings> {
  return readIntakeSettings(await scope(ctx));
}

/** 設定を保存する。行が無ければ作る。 */
export async function saveIntakeSettings(
  ctx: InventoryContext,
  value: IntakeSettingsFormValue,
): Promise<void> {
  const householdId = await scope(ctx);

  await db.intakeSetting.upsert({
    where: { householdId },
    create: { householdId, ...value },
    update: { ...value },
  });
}

/** 設定で選ばれたモデル。選んでいなければ環境変数の既定を使う。 */
export function resolveModel(settings: IntakeSettings, fallback: IntakeModelId): IntakeModelId {
  return toIntakeModel(settings.model) ?? fallback;
}

/** 設定フォームの入力を検証する。画面の値をそのままDBへ入れない。 */
export function parseIntakeSettingsForm(input: RawInput): ParseResult<IntakeSettingsFormValue> {
  const errors: Record<string, string> = {};

  const retention = Number((input.imageRetentionDays ?? "").trim());
  if (!IMAGE_RETENTION_CHOICES.some((days) => days === retention)) {
    errors.imageRetentionDays = "保存期間を選んでください。";
  }

  const requestLimit = parseLimit(input.monthlyRequestLimit, MAX_MONTHLY_REQUESTS);
  if (requestLimit === null) {
    errors.monthlyRequestLimit = `0〜${MAX_MONTHLY_REQUESTS}の整数で入力してください（0は上限なし）。`;
  }

  const costLimit = parseLimit(input.monthlyCostLimitYen, MAX_MONTHLY_COST_YEN);
  if (costLimit === null) {
    errors.monthlyCostLimitYen = `0〜${MAX_MONTHLY_COST_YEN}の整数で入力してください（0は上限なし）。`;
  }

  const model = (input.model ?? "").trim();
  if (model !== "" && !INTAKE_MODELS.some((id) => id === model)) {
    errors.model = "選べるモデルではありません。";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      imageRetentionDays: retention,
      sendProductNames: (input.sendProductNames ?? "") === "on",
      monthlyRequestLimit: requestLimit as number,
      monthlyCostLimitYen: costLimit as number,
      stopOnLimit: (input.stopOnLimit ?? "") === "on",
      model,
    },
  };
}

/** 0以上の整数だけを受け付ける。読めなければ`null`（呼び出し側がエラーにする）。 */
function parseLimit(raw: string | null | undefined, max: number): number | null {
  const text = (raw ?? "").trim().replace(/,/g, "");
  if (!/^\d{1,6}$/.test(text)) return null;
  const value = Number(text);
  return value <= max ? value : null;
}

/** 入力エラーを`InventoryInputError`として投げたいときのための入口（Server Actionから使う）。 */
export function assertIntakeSettings(input: RawInput): IntakeSettingsFormValue {
  const parsed = parseIntakeSettingsForm(input);
  if (parsed.ok) return parsed.value;
  const [field, message] = Object.entries(parsed.errors)[0] ?? ["form", "入力を確認してください。"];
  throw new InventoryInputError(field, message);
}
