"use client";

import { useActionState } from "react";

import { EMPTY_FORM_STATE, type InventoryFormState } from "@/app/(app)/form-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { INTAKE_MODELS, MODEL_PRICING, type IntakeModelId } from "@/lib/intake/config";
import {
  IMAGE_RETENTION_CHOICES,
  IMAGE_RETENTION_LABELS,
  type IntakeSettingsFormValue,
} from "@/lib/intake/settings";

/**
 * 写真取込の設定フォーム（#10）。
 *
 * 受入条件の「画像の保存期間、削除、モデルへの送信範囲、費用上限を設定可能にする」を
 * この1画面にまとめている。
 *
 * **資格情報（APIキー・トークン）の入力欄は置かない。** 画面から入れられるようにすると、
 * 値がフォームの再表示やエラーのたびにHTMLへ載り、ログにも残りうる。サーバーの環境変数だけで扱う。
 */
export function IntakeSettingsForm({
  action,
  initial,
  defaultModel,
}: {
  action: (state: InventoryFormState, formData: FormData) => Promise<InventoryFormState>;
  initial: IntakeSettingsFormValue;
  /** 設定でモデルを選んでいないときに使われるモデル（環境変数の既定）。 */
  defaultModel: IntakeModelId;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_FORM_STATE);

  const dirty = Object.keys(state.values).length > 0;
  const text = (key: "monthlyRequestLimit" | "monthlyCostLimitYen" | "model"): string =>
    state.values[key] ?? String(initial[key]);
  const checked = (key: "sendProductNames" | "stopOnLimit"): boolean =>
    dirty ? state.values[key] === "on" : initial[key];
  const retention = Number(state.values.imageRetentionDays ?? initial.imageRetentionDays);

  return (
    <form action={formAction} className="flex flex-1 flex-col">
      {state.errors.form ? (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/10 text-destructive mx-4 mt-4 rounded-lg border px-3 py-2 text-sm md:mx-6"
        >
          {state.errors.form}
        </p>
      ) : null}

      <div className="flex flex-col gap-4 px-4 py-4 md:px-6">
        <section className="flex flex-col gap-3 rounded-xl border px-4 py-4">
          <div>
            <h2 className="text-sm font-semibold">画像の保存期間</h2>
            <p className="text-muted-foreground text-xs">
              期間を過ぎた画像は自動で消えます。候補と、反映した在庫はそのまま残ります。
            </p>
          </div>

          <div className="flex flex-col gap-2">
            {IMAGE_RETENTION_CHOICES.map((days) => (
              <label
                key={days}
                className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm ${
                  retention === days ? "ring-foreground border-foreground ring-1" : ""
                }`}
              >
                <input
                  type="radio"
                  name="imageRetentionDays"
                  value={days}
                  defaultChecked={retention === days}
                  className="mt-1 size-4"
                />
                <span>
                  {IMAGE_RETENTION_LABELS[days]}
                  {days === 30 ? <b>（既定）</b> : null}
                  {days === 0 ? (
                    <span className="text-muted-foreground block text-xs">
                      二重登録を防ぐためのハッシュだけが残ります。あとから写真を見て直すことはできません。
                    </span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
          {state.errors.imageRetentionDays ? (
            <p role="alert" className="text-destructive text-xs font-semibold">
              {state.errors.imageRetentionDays}
            </p>
          ) : null}
        </section>

        <section className="flex flex-col gap-3 rounded-xl border px-4 py-4">
          <div>
            <h2 className="text-sm font-semibold">モデルへ送る範囲</h2>
            <p className="text-muted-foreground text-xs">
              送信先は Anthropic Claude API です。在庫の数量・期限・保管場所・家族の情報は送りません。
            </p>
          </div>

          <div className="flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm">
            <input type="checkbox" checked disabled className="mt-1 size-4" />
            <span>
              撮影した画像
              <span className="text-muted-foreground block text-xs">
                読み取りに必要なため外せません。長辺1600pxへ縮めてから送ります。
              </span>
            </span>
          </div>

          <label className="flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm">
            <input
              type="checkbox"
              name="sendProductNames"
              defaultChecked={checked("sendProductNames")}
              className="mt-1 size-4"
            />
            <span>
              登録済みの商品名の一覧も送る
              <span className="text-muted-foreground block text-xs">
                レシートの略称を既存の商品へ寄せやすくなります。送るのは商品名だけですが、
                家庭の持ち物が分かるため既定はオフです。
              </span>
            </span>
          </label>
        </section>

        <section className="flex flex-col gap-3 rounded-xl border px-4 py-4">
          <div>
            <h2 className="text-sm font-semibold">費用の上限</h2>
            <p className="text-muted-foreground text-xs">
              月あたりの上限です。0を入れると上限なし。金額はトークン数からの概算で、
              請求の正はAnthropic側の明細です。
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <NumberField
              id="monthlyRequestLimit"
              label="月あたりの回数"
              hint="この回数を超えると読み取りを止めます"
              defaultValue={text("monthlyRequestLimit")}
              error={state.errors.monthlyRequestLimit}
            />
            <NumberField
              id="monthlyCostLimitYen"
              label="月あたりの概算金額（円）"
              hint="概算がこの金額に達すると止めます"
              defaultValue={text("monthlyCostLimitYen")}
              error={state.errors.monthlyCostLimitYen}
            />
          </div>

          <label className="flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm">
            <input
              type="checkbox"
              name="stopOnLimit"
              defaultChecked={checked("stopOnLimit")}
              className="mt-1 size-4"
            />
            <span>
              上限に達したら読み取りを止める
              <span className="text-muted-foreground block text-xs">
                止まっている間も、この画面と手入力での登録は使えます。
              </span>
            </span>
          </label>
        </section>

        <section className="flex flex-col gap-3 rounded-xl border px-4 py-4">
          <div>
            <h2 className="text-sm font-semibold">使うモデル</h2>
            <p className="text-muted-foreground text-xs">
              1回の読み取りは写真1〜2枚ぶんです。迷ったら既定のままで構いません。
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="model" className="text-xs font-semibold">
              モデル
            </Label>
            <select
              id="model"
              name="model"
              defaultValue={text("model")}
              className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-11 w-full rounded-lg border px-3 text-base transition-[color,box-shadow] outline-none focus-visible:ring-3"
            >
              <option value="">サーバーの既定にまかせる（{defaultModel}）</option>
              {INTAKE_MODELS.map((model) => (
                <option key={model} value={model}>
                  {model}（{MODEL_PRICING[model].note}）
                </option>
              ))}
            </select>
            {state.errors.model ? (
              <p role="alert" className="text-destructive text-xs font-semibold">
                {state.errors.model}
              </p>
            ) : null}
          </div>
        </section>
      </div>

      <div className="bg-background sticky bottom-0 mt-auto flex gap-2 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6">
        <Button type="submit" className="h-11 flex-1" disabled={pending}>
          {pending ? "保存中…" : "保存する"}
        </Button>
      </div>
    </form>
  );
}

function NumberField({
  id,
  label,
  hint,
  defaultValue,
  error,
}: {
  id: string;
  label: string;
  hint: string;
  defaultValue: string;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs font-semibold">
        {label}
      </Label>
      <Input
        id={id}
        name={id}
        inputMode="numeric"
        defaultValue={defaultValue}
        className="h-11 text-base tabular-nums"
      />
      {error ? (
        <p role="alert" className="text-destructive text-xs font-semibold">
          {error}
        </p>
      ) : (
        <p className="text-muted-foreground text-xs">{hint}</p>
      )}
    </div>
  );
}
