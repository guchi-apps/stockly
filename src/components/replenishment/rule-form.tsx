"use client";

import { useActionState } from "react";

import { EMPTY_FORM_STATE } from "@/app/(app)/form-state";
import { createReplenishmentRuleAction } from "@/app/(app)/replenishment/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UNIT_DEFINITIONS } from "@/lib/inventory/units";
import type { UnitCode } from "@/lib/inventory/units";

/**
 * 補充基準の追加フォーム。
 *
 * 対象は`product:<id>` / `category:<id>`という1つの値で受け取る（`rules.ts`の`parseTargetRef()`）。
 * 「種別」と「対象」を別の欄にすると、片方だけ変えた食い違った組み合わせが送れてしまうため。
 */
const SELECT_CLASS =
  "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-11 rounded-lg border px-3 text-base outline-none focus-visible:ring-3";

export interface RuleTargetOption {
  readonly value: string;
  readonly label: string;
  /** 商品の既定の単位。選んだときに判定単位の初期値を決めるための参考値。 */
  readonly defaultUnit?: UnitCode;
}

export function ReplenishmentRuleForm({
  products,
  categories,
}: {
  products: readonly RuleTargetOption[];
  categories: readonly RuleTargetOption[];
}) {
  const [state, formAction, pending] = useActionState(
    createReplenishmentRuleAction,
    EMPTY_FORM_STATE,
  );

  const hasTarget = products.length > 0 || categories.length > 0;

  return (
    <form action={formAction} className="flex flex-col gap-3 px-4 py-5 md:px-6">
      <h2 className="text-sm font-semibold">補充基準を追加</h2>

      {hasTarget ? null : (
        <p className="text-muted-foreground text-xs">
          在庫に登録した商品・カテゴリが対象になります。すべての対象に基準があるか、まだ在庫が登録されていません。
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <div className="flex min-w-56 flex-col gap-1.5">
          <Label htmlFor="rule-target" className="text-xs font-semibold">
            対象
          </Label>
          <select
            id="rule-target"
            name="target"
            defaultValue={state.values.target ?? ""}
            disabled={!hasTarget}
            className={SELECT_CLASS}
          >
            <option value="">選んでください</option>
            {products.length > 0 ? (
              <optgroup label="商品">
                {products.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {categories.length > 0 ? (
              <optgroup label="カテゴリ（配下の商品の在庫を合計して判定）">
                {categories.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
          {state.errors.target ? (
            <p role="alert" className="text-destructive text-xs font-semibold">
              {state.errors.target}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-threshold" className="text-xs font-semibold">
            補充基準（これ以下で候補）
          </Label>
          <Input
            id="rule-threshold"
            name="thresholdAmount"
            inputMode="decimal"
            defaultValue={state.values.thresholdAmount ?? ""}
            placeholder="2"
            required
            className="h-11 w-32 text-base"
          />
          {state.errors.thresholdAmount ? (
            <p role="alert" className="text-destructive text-xs font-semibold">
              {state.errors.thresholdAmount}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-target-amount" className="text-xs font-semibold">
            目標数量
          </Label>
          <Input
            id="rule-target-amount"
            name="targetAmount"
            inputMode="decimal"
            defaultValue={state.values.targetAmount ?? ""}
            placeholder="12"
            required
            className="h-11 w-32 text-base"
          />
          {state.errors.targetAmount ? (
            <p role="alert" className="text-destructive text-xs font-semibold">
              {state.errors.targetAmount}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-unit" className="text-xs font-semibold">
            判定単位
          </Label>
          <select
            id="rule-unit"
            name="unit"
            defaultValue={state.values.unit ?? "PIECE"}
            className={SELECT_CLASS}
          >
            {Object.entries(UNIT_DEFINITIONS).map(([code, definition]) => (
              <option key={code} value={code}>
                {definition.label}
              </option>
            ))}
          </select>
          <p className="text-muted-foreground text-xs">この単位へ換算できない在庫は数えません</p>
        </div>
      </div>

      {state.errors.form ? (
        <p role="alert" className="text-destructive text-xs font-semibold">
          {state.errors.form}
        </p>
      ) : null}

      <Button type="submit" className="h-11 self-start px-6" disabled={pending || !hasTarget}>
        {pending ? "追加中…" : "基準を追加"}
      </Button>
    </form>
  );
}
