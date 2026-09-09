import Link from "next/link";
import { Camera, MapPin } from "lucide-react";

import { analyzeConsumptionPhotosAction } from "@/app/(app)/inventory/consume/actions";
import { ActionNotice, EmptyState, PageHeader, firstValue } from "@/components/inventory/chrome";
import {
  ConsumeCandidateCard,
  SkippedObservationList,
} from "@/components/inventory/consume-candidates";
import { ConsumePhotoInput } from "@/components/inventory/consume-photo-input";
import { SubmitButton } from "@/components/inventory/submit-button";
import { Button } from "@/components/ui/button";
import {
  getConsumptionScan,
  getConsumptionScanContext,
  getLatestConsumptionScan,
} from "@/lib/consumption/queries";
import {
  CONSUMPTION_SCAN_KINDS,
  SCAN_KIND_DEFINITIONS,
  isConsumptionScanKind,
  type ConsumptionScanKind,
} from "@/lib/consumption/kinds";
import { requireInventoryContext } from "@/lib/inventory/context";
import { formatTokyoDateTime } from "@/lib/time/tokyo";

/**
 * 写真から在庫を減らす画面（#11）。
 *
 * **この画面が減らすのは、押されたときの1件だけ。** 解析（`analyzeConsumptionPhotosAction`）は
 * 候補を作るところで止まり、在庫は`confirmConsumptionCandidateAction`でしか動かない。
 * まとめて確定するボタンも置かない（受入条件「AIが自動確定する経路を持たない」）。
 *
 * **設定が無くても画面は開く。** 解析だけができない状態を、在庫の他の画面へ波及させない
 * （補充の画面がNotion未設定でも開くのと同じ扱い）。
 */
export default async function ConsumePhotoPage({
  searchParams,
}: PageProps<"/inventory/consume">) {
  const { ctx } = await requireInventoryContext();
  const params = await searchParams;

  if (!ctx) {
    return (
      <EmptyState
        icon={<MapPin className="size-8" />}
        title="家庭が見つかりません"
        description="在庫は家庭に属します。ログインし直しても表示されない場合は、管理者に連絡してください。"
      />
    );
  }

  const scanId = firstValue(params.scan);
  const rawKind = firstValue(params.kind);
  const [context, scan] = await Promise.all([
    getConsumptionScanContext(ctx),
    scanId ? getConsumptionScan(ctx, scanId) : getLatestConsumptionScan(ctx),
  ]);

  const kind: ConsumptionScanKind =
    rawKind && isConsumptionScanKind(rawKind) ? rawKind : (scan?.kind ?? "EMPTY_CONTAINER");
  const redirectTo = scan ? `/inventory/consume?scan=${scan.id}` : "/inventory/consume";

  const candidates = scan?.items.filter((item) => item.skipReason === null) ?? [];
  const skipped = scan?.items.filter((item) => item.skipReason !== null) ?? [];
  const remainingRequests =
    context.stopOnLimit && context.monthlyRequestLimit > 0
      ? Math.max(0, context.monthlyRequestLimit - context.usage.requestCount)
      : null;

  return (
    <>
      <PageHeader
        title="写真から減らす"
        description="空き容器・残量・棚の写真から、減らす候補を出します"
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/history">履歴を見る</Link>
          </Button>
        }
      />

      <ActionNotice notice={firstValue(params.notice)} error={firstValue(params.error)} />

      <div className="flex flex-col gap-5 px-4 py-4 md:px-6">
        <p className="bg-muted flex gap-2.5 rounded-lg border px-3 py-2.5 text-[13px] leading-relaxed">
          <span aria-hidden>●</span>
          <span>
            <b>AIは候補を出すだけです。確定するまで在庫は変わりません。</b>{" "}
            いまの在庫に見つからない商品は、候補にも出しません。
          </span>
        </p>

        {context.configured ? (
          <CaptureForm
            kind={kind}
            maxImages={context.maxImages}
            remainingRequests={remainingRequests}
          />
        ) : (
          <NotConfigured missingKeys={context.missingKeys} />
        )}

        {scan ? (
          <section className="flex flex-col gap-3">
            <p className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px]">
              <b className="text-foreground font-sans text-xs">候補 {candidates.length}件</b>
              <span>{formatTokyoDateTime(scan.createdAt)} 解析</span>
              <span>{SCAN_KIND_DEFINITIONS[scan.kind].label}の写真 {scan.imageCount}枚</span>
              <span>判定ルール {scan.ruleVersion}</span>
              {scan.model ? <span>{scan.model}</span> : null}
              <span>画像は保存していません</span>
              <span>
                今月の読み取り {context.usage.requestCount}
                {context.monthlyRequestLimit > 0 ? ` / ${context.monthlyRequestLimit}` : ""} 回
              </span>
            </p>

            {scan.status === "FAILED" ? (
              <p
                role="alert"
                className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm"
              >
                {scan.error ?? "写真を読み取れませんでした。"}{" "}
                在庫から選んで手で減らすこともできます。
              </p>
            ) : null}

            <div className="flex flex-col gap-2.5">
              {candidates.map((item) => (
                <ConsumeCandidateCard key={item.id} item={item} redirectTo={redirectTo} />
              ))}
            </div>

            <SkippedObservationList items={skipped} />

            <p className="text-muted-foreground border-t pt-3 text-xs leading-relaxed">
              減らすと、ふつうの消費として履歴に残ります。間違えたら
              <Link href="/history" className="underline">
                履歴の画面
              </Link>
              からいつでも取り消せます。
            </p>
          </section>
        ) : (
          <EmptyState
            icon={<Camera className="size-8" />}
            title="飲み終わった容器を撮ってみてください"
            description="棚をまとめて撮ることもできます。出てくるのは候補だけで、確かめて押すまで在庫は変わりません。"
          />
        )}
      </div>
    </>
  );
}

/**
 * 撮影・アップロードのフォーム。
 *
 * **サーバーコンポーネントのフォームのままにしてある**（`action`にServer Actionを直接渡す）。
 * JSが無くても送信でき、GUIの無い環境から`curl`で確かめられる（[CLAUDE.md](../../../../../CLAUDE.md)の
 * 「`multipart/form-data`でPOSTする」）。写真の変換・縮小だけをクライアント側で上乗せする。
 */
function CaptureForm({
  kind,
  maxImages,
  remainingRequests,
}: {
  kind: ConsumptionScanKind;
  maxImages: number;
  /** 今月あと何回読み取れるか。上限を設けていなければ`null`。 */
  remainingRequests: number | null;
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border">
      <nav className="flex gap-1 border-b px-2 pt-2" aria-label="写真の種類">
        {CONSUMPTION_SCAN_KINDS.map((value) => (
          <Link
            key={value}
            href={`/inventory/consume?kind=${value}`}
            aria-current={value === kind ? "page" : undefined}
            className={
              value === kind
                ? "border-foreground -mb-px border-b-2 px-3 pt-1.5 pb-2 text-[13px] font-bold"
                : "text-muted-foreground -mb-px border-b-2 border-transparent px-3 pt-1.5 pb-2 text-[13px]"
            }
          >
            {SCAN_KIND_DEFINITIONS[value].label}
          </Link>
        ))}
      </nav>

      <form action={analyzeConsumptionPhotosAction} className="flex flex-col gap-3 px-4 py-3">
        <input type="hidden" name="kind" value={kind} />

        <p className="text-muted-foreground text-xs">{SCAN_KIND_DEFINITIONS[kind].hint}</p>

        <ConsumePhotoInput maxImages={maxImages} />

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton variant="default" className="h-11" pendingLabel="読み取っています…">
            この写真から候補を出す
          </SubmitButton>
          <p className="text-muted-foreground text-[11px] leading-relaxed">
            JPEG・PNG・WebP、一度に{maxImages}枚まで。位置情報は送る前に取り除き、画像は保存しません。
            <br />
            {remainingRequests === null
              ? "読み取りの回数と費用の上限は、写真取込の設定から変えられます。"
              : `今月はあと${remainingRequests}回まで読み取れます（上限は写真取込の設定から変えられます）。`}
          </p>
        </div>
      </form>
    </div>
  );
}

/**
 * 資格情報が無いとき。**在庫の他の画面は使えるので、ここだけを止める。**
 *
 * 資格情報は写真取込（#10）と共通なので、案内も同じものを指す。
 */
function NotConfigured({ missingKeys }: { missingKeys: readonly string[] }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-dashed px-4 py-4">
      <b className="text-sm font-semibold">写真の読み取りはまだ設定されていません</b>
      <p className="text-muted-foreground text-xs leading-relaxed">
        {missingKeys.length > 0 ? `${missingKeys.join(" か ")} のどちらかが必要です。` : ""}
        設定が済むまでは、在庫の画面から商品を選んで手で減らしてください。
      </p>
      <div className="flex gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href="/inventory">在庫から選ぶ</Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link href="/intake/settings">写真取込の設定</Link>
        </Button>
      </div>
    </div>
  );
}
