/**
 * 補充の画面から来た入力を読み取る純関数。
 *
 * 数量の読み取り・エラーの伝え方は在庫側（`src/lib/inventory/operations.ts`）と揃える。
 * 同じ画面で使う欄なので、全角数字の正規化やメッセージの言い回しを二重に持たない。
 */
import { InventoryInputError, parseAmount, parseUnit } from "../inventory/operations.ts";
import type { FieldErrors, ParseResult, RawInput } from "../inventory/operations.ts";
import { Decimal, type UnitCode } from "../inventory/units.ts";
import {
  REPLENISHMENT_TARGET_KINDS,
  type ReplenishmentTargetKind,
} from "./shortage.ts";

/** 1回の送信で扱う候補の上限。NotionのAPIを一度に叩きすぎないための歯止め。 */
export const MAX_SEND_BATCH_SIZE = 20;

export interface ReplenishmentRuleFormValue {
  readonly targetKind: ReplenishmentTargetKind;
  /** 対象（商品またはカテゴリ）のid。 */
  readonly targetId: string;
  readonly thresholdAmount: Decimal;
  readonly targetAmount: Decimal;
  readonly unit: UnitCode;
  readonly enabled: boolean;
}

/**
 * 対象は`product:<id>` / `category:<id>`の1つのselectで受け取る。
 *
 * 種別と対象を別の欄に分けると、JSが無い環境では「商品を選んだのに種別がカテゴリのまま」
 * という組み合わせが送れてしまう。1つの値にまとめておけば、その食い違いが起きない。
 */
export function parseTargetRef(
  raw: string | undefined | null,
  field = "target",
): { kind: ReplenishmentTargetKind; id: string } {
  const value = (raw ?? "").trim();
  const separator = value.indexOf(":");
  const prefix = separator === -1 ? "" : value.slice(0, separator);
  const id = separator === -1 ? "" : value.slice(separator + 1);

  const kind = REPLENISHMENT_TARGET_KINDS.find((candidate) => candidate.toLowerCase() === prefix);
  if (!kind || id === "") {
    throw new InventoryInputError(field, "対象の商品またはカテゴリを選んでください。");
  }
  return { kind, id };
}

export function formatTargetRef(kind: ReplenishmentTargetKind, id: string): string {
  return `${kind.toLowerCase()}:${id}`;
}

export function parseReplenishmentRuleForm(
  input: RawInput,
): ParseResult<ReplenishmentRuleFormValue> {
  return collect(() => {
    const target = parseTargetRef(input.target);
    // 「これ以下になったら買う」の基準は0を許す（「切らしたら買う」が普通にあるため）。
    const thresholdAmount = parseAmount(input.thresholdAmount, "thresholdAmount", "補充基準", {
      allowZero: true,
    });
    const targetAmount = parseAmount(input.targetAmount, "targetAmount", "目標数量");

    if (targetAmount.lessThanOrEqualTo(thresholdAmount)) {
      throw new InventoryInputError(
        "targetAmount",
        "目標数量は補充基準より大きい値にしてください（同じだと、買っても候補に出続けます）。",
      );
    }

    return {
      targetKind: target.kind,
      targetId: target.id,
      thresholdAmount,
      targetAmount,
      unit: parseUnit(input.unit),
      enabled: (input.enabled ?? "on").trim() !== "off",
    };
  });
}

/** 基準の数量だけを直すインライン編集の入力。対象と単位は変えない。 */
export interface ReplenishmentRuleAmountsValue {
  readonly thresholdAmount: Decimal;
  readonly targetAmount: Decimal;
}

export function parseReplenishmentRuleAmounts(
  input: RawInput,
): ParseResult<ReplenishmentRuleAmountsValue> {
  return collect(() => {
    const thresholdAmount = parseAmount(input.thresholdAmount, "thresholdAmount", "補充基準", {
      allowZero: true,
    });
    const targetAmount = parseAmount(input.targetAmount, "targetAmount", "目標数量");
    if (targetAmount.lessThanOrEqualTo(thresholdAmount)) {
      throw new InventoryInputError(
        "targetAmount",
        "目標数量は補充基準より大きい値にしてください。",
      );
    }
    return { thresholdAmount, targetAmount };
  });
}

/**
 * 送信する候補として選ばれた基準のid。
 *
 * チェックボックスは同じ名前で複数送られてくるため、呼び出し側が`formData.getAll()`の
 * 結果を渡す。上限を超えた選択はここで断る（Notionのレート制限への歯止め）。
 */
export function parseSelectedRuleIds(values: readonly string[]): ParseResult<string[]> {
  return collect(() => {
    const ids = [...new Set(values.map((value) => value.trim()).filter((value) => value !== ""))];
    if (ids.length === 0) {
      throw new InventoryInputError("ruleIds", "送る候補を1件以上選んでください。");
    }
    if (ids.length > MAX_SEND_BATCH_SIZE) {
      throw new InventoryInputError(
        "ruleIds",
        `一度に送れるのは${MAX_SEND_BATCH_SIZE}件までです。分けて送ってください。`,
      );
    }
    return ids;
  });
}

function collect<T>(build: () => T): ParseResult<T> {
  try {
    return { ok: true, value: build() };
  } catch (error) {
    if (error instanceof InventoryInputError) {
      const errors: FieldErrors = { [error.field]: error.message };
      return { ok: false, errors };
    }
    throw error;
  }
}
