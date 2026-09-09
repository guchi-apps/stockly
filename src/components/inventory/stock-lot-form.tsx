"use client";

import { useActionState, useId, useState, type ReactNode } from "react";
import Link from "next/link";

import { EMPTY_FORM_STATE, type InventoryFormState } from "@/app/(app)/form-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SourceChip } from "@/components/inventory/source-chip";
import type { CandidateSource, CandidateSources } from "@/lib/barcode/candidate";
import { EXPIRY_KINDS, EXPIRY_KIND_LABELS, hasExpiryDate } from "@/lib/inventory/operations";
import { UNIT_DEFINITIONS } from "@/lib/inventory/units";

/**
 * 在庫の登録・編集フォーム。
 *
 * 選択肢は`<select>`（ネイティブ）で出している。スマホではOSのピッカーが開き、
 * ハイドレーションを待たずに操作でき、キーボード操作もOS任せで正しく動くため。
 *
 * 詳細位置は選んだ保管場所の配下だけを出す必要があるので、そこだけクライアントの状態を持つ。
 * 送信された値が不正だった場合は`useActionState`が入力値ごと返すので、打ち直しにならない。
 *
 * バーコードから来た欄には出所のチップを付ける（#9）。どこから来た値か分からないまま
 * 埋まっていると、そのままでよいのか直すべきなのかを判断できない。
 */
export interface StorageLocationOption {
  id: string;
  name: string;
  positions: { id: string; name: string }[];
}

export interface StockLotFormInitial {
  productName?: string;
  categoryName?: string;
  amount?: string;
  unit?: string;
  storageLocationId?: string;
  storagePositionId?: string;
  expiryKind?: string;
  expiryDate?: string;
  opened?: boolean;
  note?: string;
}

export function StockLotForm({
  action,
  operationId,
  locations,
  categories,
  initial = {},
  submitLabel,
  cancelHref,
  hidden = {},
  lockUnit = false,
  amountHint,
  sources = {},
  beforeFields,
}: {
  action: (state: InventoryFormState, formData: FormData) => Promise<InventoryFormState>;
  operationId: string;
  locations: StorageLocationOption[];
  categories: { id: string; name: string }[];
  initial?: StockLotFormInitial;
  submitLabel: string;
  cancelHref: string;
  hidden?: Record<string, string>;
  lockUnit?: boolean;
  amountHint?: string;
  /** 欄ごとの候補の出所。バーコードから開いたときだけ渡る。 */
  sources?: CandidateSources;
  /** 入力欄の上に差し込む案内（バーコードの照合結果・付け替えの確認など）。 */
  beforeFields?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_FORM_STATE);
  const listId = useId();

  // 送信して戻ってきた値があればそれを、無ければ初期値を出す。
  const value = (key: keyof StockLotFormInitial, fallback = ""): string =>
    state.values[key] ?? (initial[key] as string | undefined) ?? fallback;

  const [locationId, setLocationId] = useState(
    () => state.values.storageLocationId ?? initial.storageLocationId ?? locations[0]?.id ?? "",
  );
  const positions = locations.find((location) => location.id === locationId)?.positions ?? [];

  // 既定は「未確認」。日付を入れずに登録したものは、期限内ではなく要確認として出す。
  const [expiryKind, setExpiryKind] = useState(
    () => state.values.expiryKind ?? initial.expiryKind ?? "UNKNOWN",
  );

  return (
    <form action={formAction} className="flex flex-1 flex-col">
      <input type="hidden" name="operationId" value={operationId} />
      {Object.entries(hidden).map(([name, hiddenValue]) => (
        <input key={name} type="hidden" name={name} value={hiddenValue} />
      ))}

      {state.errors.form ? (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/10 text-destructive mx-4 mt-4 rounded-lg border px-3 py-2 text-sm md:mx-6"
        >
          {state.errors.form}
        </p>
      ) : null}

      {beforeFields ? <div className="px-4 pt-4 md:px-6">{beforeFields}</div> : null}

      <div className="flex flex-col gap-4 px-4 py-4 md:px-6">
        <Field
          label="商品名"
          error={state.errors.productName}
          htmlFor="productName"
          source={sources.productName}
        >
          <Input
            id="productName"
            name="productName"
            defaultValue={value("productName")}
            required
            autoComplete="off"
            className="h-11 text-base"
          />
        </Field>

        <Field
          label="カテゴリ"
          error={state.errors.categoryName}
          htmlFor="categoryName"
          hint="未登録の名前を入れると、そのカテゴリを作ります。"
          source={sources.categoryName}
        >
          <Input
            id="categoryName"
            name="categoryName"
            list={listId}
            defaultValue={value("categoryName")}
            autoComplete="off"
            className="h-11 text-base"
          />
          <datalist id={listId}>
            {categories.map((category) => (
              <option key={category.id} value={category.name} />
            ))}
          </datalist>
        </Field>

        <div className="grid grid-cols-[1fr_8rem] gap-3">
          <Field label="数量" error={state.errors.amount} htmlFor="amount" hint={amountHint}>
            <Input
              id="amount"
              name="amount"
              inputMode="decimal"
              defaultValue={value("amount", "1")}
              required
              className="h-11 text-base"
            />
          </Field>

          <Field label="単位" error={state.errors.unit} htmlFor="unit" source={sources.unit}>
            {lockUnit ? (
              <>
                <input type="hidden" name="unit" value={value("unit", "PIECE")} />
                <p className="border-input flex h-11 items-center rounded-lg border px-3 text-base">
                  {UNIT_DEFINITIONS[value("unit", "PIECE") as keyof typeof UNIT_DEFINITIONS]?.label}
                </p>
              </>
            ) : (
              <NativeSelect id="unit" name="unit" defaultValue={value("unit", "PIECE")}>
                {Object.entries(UNIT_DEFINITIONS).map(([code, definition]) => (
                  <option key={code} value={code}>
                    {definition.label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        </div>

        {locations.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-3 text-sm">
            保管場所がまだありません。
            <Link href="/storage" className="underline underline-offset-2">
              保管場所
            </Link>
            で先に作ると、ここで選べるようになります。
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="保管場所"
              error={state.errors.storageLocationId}
              htmlFor="storageLocationId"
              source={sources.storageLocationId}
            >
              <NativeSelect
                id="storageLocationId"
                name="storageLocationId"
                value={locationId}
                onChange={(event) => setLocationId(event.target.value)}
              >
                <option value="">未設定</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            <Field
              label="詳細位置"
              error={state.errors.storagePositionId}
              htmlFor="storagePositionId"
              source={sources.storagePositionId}
            >
              <NativeSelect
                id="storagePositionId"
                name="storagePositionId"
                defaultValue={value("storagePositionId")}
                disabled={positions.length === 0}
                key={locationId}
              >
                <option value="">未設定</option>
                {positions.map((position) => (
                  <option key={position.id} value={position.id}>
                    {position.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="期限"
            error={state.errors.expiryKind}
            htmlFor="expiryKind"
            source={sources.expiryKind}
          >
            <NativeSelect
              id="expiryKind"
              name="expiryKind"
              value={expiryKind}
              onChange={(event) => setExpiryKind(event.target.value)}
            >
              {EXPIRY_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {EXPIRY_KIND_LABELS[kind]}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <Field
            label="日付"
            error={state.errors.expiryDate}
            htmlFor="expiryDate"
            source={sources.expiryDate}
          >
            <Input
              id="expiryDate"
              name="expiryDate"
              type="date"
              defaultValue={value("expiryDate")}
              disabled={!hasExpiryDate(expiryKind as (typeof EXPIRY_KINDS)[number])}
              className="h-11 text-base"
            />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="opened"
            defaultChecked={state.values.opened === "on" || initial.opened === true}
            className="size-4"
          />
          開封済み（開封後の期限として扱う）
        </label>

        <Field label="メモ" error={state.errors.note} htmlFor="note">
          <Textarea id="note" name="note" defaultValue={value("note")} rows={2} />
        </Field>
      </div>

      <div className="bg-background sticky bottom-0 mt-auto flex gap-2 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6">
        <Button asChild variant="outline" className="h-11 flex-1">
          <Link href={cancelHref}>キャンセル</Link>
        </Button>
        <Button type="submit" className="h-11 flex-1" disabled={pending}>
          {pending ? "送信中…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  error,
  hint,
  source,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  source?: CandidateSource;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Label htmlFor={htmlFor} className="text-xs font-semibold">
          {label}
        </Label>
        {source ? <SourceChip source={source} /> : null}
      </div>
      {children}
      {error ? (
        <p role="alert" className="text-destructive text-xs font-semibold">
          {error}
        </p>
      ) : hint ? (
        <p className="text-muted-foreground text-xs">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * ネイティブの`<select>`。
 *
 * shadcn/uiのSelectを使わないのは、スマホでOSのピッカーを開かせたいのと、
 * JSが読み込まれる前でも選べるようにするため。見た目はInputに揃えてある。
 */
function NativeSelect(props: React.ComponentProps<"select">) {
  return (
    <select
      {...props}
      className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-11 w-full rounded-lg border px-3 text-base transition-[color,box-shadow] outline-none focus-visible:ring-3 disabled:opacity-50"
    />
  );
}
