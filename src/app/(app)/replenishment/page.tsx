import Link from "next/link";
import { ExternalLink, ShoppingCart, SlidersHorizontal } from "lucide-react";

import {
  deleteShoppingListEntryAction,
  resendShoppingListEntryAction,
  sendCandidatesAction,
} from "@/app/(app)/replenishment/actions";
import { ActionNotice, EmptyState, PageHeader, firstValue } from "@/components/inventory/chrome";
import { SubmitButton } from "@/components/inventory/submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireInventoryContext } from "@/lib/inventory/context";
import { UNIT_DEFINITIONS } from "@/lib/inventory/units";
import { missingNotionConfigKeys } from "@/lib/notion/config";
import { loadReplenishmentOverview } from "@/lib/replenishment/queries";
import {
  TARGET_KIND_LABELS,
  describeRule,
  formatAmountWithUnit,
  type ShortageResult,
} from "@/lib/replenishment/shortage";

const STATUS_LABELS = {
  PENDING: "未送信",
  SENDING: "送信中",
  SENT: "送信済み",
  FAILED: "送信できず",
} as const;

export default async function ReplenishmentPage({ searchParams }: PageProps<"/replenishment">) {
  const params = await searchParams;
  const { ctx, householdName } = await requireInventoryContext();

  if (!ctx) {
    return (
      <EmptyState
        icon={<ShoppingCart className="size-8" />}
        title="家庭が見つかりません"
        description="補充の基準は家庭に属します。ログインし直しても表示されない場合は、管理者に連絡してください。"
      />
    );
  }

  const { results, shortages, entries } = await loadReplenishmentOverview(ctx);
  // 未設定の環境変数名だけを見る（値そのものは画面にもログにも出さない）。
  const missingConfig = missingNotionConfigKeys();
  const canSend = missingConfig.length === 0;

  return (
    <>
      <PageHeader
        title="補充"
        description={householdName ?? "不足した在庫を買い物リストへ"}
        actions={
          <Button asChild variant="outline" size="lg">
            <Link href="/replenishment/rules">
              <SlidersHorizontal className="size-4" aria-hidden />
              補充基準
            </Link>
          </Button>
        }
      />

      <ActionNotice notice={firstValue(params.notice)} error={firstValue(params.error)} />

      {canSend ? (
        <p className="text-muted-foreground bg-muted mx-4 mt-4 rounded-lg border px-3 py-2 text-xs md:mx-6">
          送信先はNotionの買い物リストです。Notion側で完了・削除しても、Stocklyの在庫は変わりません。
        </p>
      ) : (
        <p
          role="status"
          className="mx-4 mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 md:mx-6 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
        >
          Notionの接続先が未設定のため、候補の確認だけができます（{missingConfig.join(" / ")}
          を設定すると送れるようになります）。
        </p>
      )}

      {results.length === 0 ? (
        <EmptyState
          icon={<SlidersHorizontal className="size-8" />}
          title="補充基準がまだありません"
          description="よく買うものに「これ以下になったら買う」を決めると、不足したときにここへ候補が並びます。"
          action={
            <Button asChild size="lg" className="mt-1">
              <Link href="/replenishment/rules">補充基準を作る</Link>
            </Button>
          }
        />
      ) : shortages.length === 0 ? (
        <EmptyState
          icon={<ShoppingCart className="size-8" />}
          title="買い足すものはありません"
          description={`${results.length}件の基準はすべて足りています。消費を記録すると、基準を下回ったものがここに出ます。`}
        />
      ) : (
        <form action={sendCandidatesAction}>
          <input type="hidden" name="redirectTo" value="/replenishment" />

          <h2 className="text-muted-foreground bg-muted/40 flex items-baseline gap-2 border-b px-4 py-1.5 text-xs font-semibold md:px-6">
            補充候補
            <span className="font-normal">{shortages.length}件</span>
          </h2>

          <ul>
            {shortages.map((shortage) => (
              <li key={shortage.ruleId} className="border-b px-4 py-3 md:px-6">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    name="ruleIds"
                    value={shortage.ruleId}
                    defaultChecked
                    className="accent-primary mt-1 size-4 shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="text-[15px] font-semibold">{shortage.target.name}</span>
                    <span className="text-muted-foreground block text-xs">
                      いま{formatAmountWithUnit(shortage.currentAmount, shortage.unit)} ・
                      {describeRule(shortage)}
                    </span>
                    <span className="mt-1.5 flex flex-wrap gap-1.5">
                      <Badge variant="outline">
                        {TARGET_KIND_LABELS[shortage.target.kind]}ごとの基準
                      </Badge>
                      <ExcludedLotsBadges shortage={shortage} />
                    </span>
                  </span>
                  <span className="shrink-0 text-right tabular-nums">
                    <span className="text-[17px] font-semibold">
                      {shortage.shortageAmount.toDecimalPlaces(3).toString()}
                    </span>
                    <span className="text-muted-foreground ml-0.5 text-xs font-medium">
                      {UNIT_DEFINITIONS[shortage.unit].label}
                    </span>
                    <span className="text-muted-foreground block text-[11px]">不足</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3 md:px-6">
            <SubmitButton
              variant="default"
              size="lg"
              className="h-11 px-5"
              pendingLabel="送信中…"
              disabled={!canSend}
            >
              選んだ候補をNotionへ送る
            </SubmitButton>
            <p className="text-muted-foreground flex-1 text-xs">
              同じ候補を送り直しても、Notionの同じ項目が更新されるだけで増えません。
            </p>
          </div>
        </form>
      )}

      {entries.length > 0 ? (
        <>
          <h2 className="text-muted-foreground bg-muted/40 flex items-baseline gap-2 border-b px-4 py-1.5 text-xs font-semibold md:px-6">
            送信済み
            <span className="font-normal">{entries.length}件</span>
          </h2>

          <ul>
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b px-4 py-3 md:px-6"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold">{entry.name}</p>
                  <p className="text-muted-foreground text-xs">
                    {formatAmountWithUnit(entry.shortageAmount, entry.unit)}
                    {entry.lastSentAt
                      ? ` を ${entry.lastSentAt.toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" })} に送信`
                      : " を送信予定"}
                    {" ・ 対応ID "}
                    <code className="text-[11px]">stockly:{entry.id}</code>
                  </p>
                  {entry.lastError ? (
                    <p role="alert" className="text-destructive mt-1 text-xs">
                      {entry.lastError}
                    </p>
                  ) : null}
                  <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge variant={entry.status === "FAILED" ? "destructive" : "outline"}>
                      {STATUS_LABELS[entry.status]}
                    </Badge>
                    {entry.notionUrl ? (
                      <a
                        href={entry.notionUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-muted-foreground inline-flex items-center gap-1 text-xs underline underline-offset-2"
                      >
                        Notionで開く
                        <ExternalLink className="size-3" aria-hidden />
                      </a>
                    ) : null}
                  </span>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <form action={resendShoppingListEntryAction}>
                    <input type="hidden" name="entryId" value={entry.id} />
                    <input type="hidden" name="redirectTo" value="/replenishment" />
                    <SubmitButton className="h-9" pendingLabel="送信中…" disabled={!canSend}>
                      送り直す
                    </SubmitButton>
                  </form>

                  <form action={deleteShoppingListEntryAction}>
                    <input type="hidden" name="entryId" value={entry.id} />
                    <input type="hidden" name="redirectTo" value="/replenishment" />
                    <SubmitButton variant="ghost" className="text-muted-foreground h-9">
                      取り下げる
                    </SubmitButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>

          <p className="text-muted-foreground px-4 py-4 text-xs md:px-6">
            買ってNotionで消しても、この記録は自動では消えません（Notion側の変更をStocklyへ
            戻さないため）。「取り下げる」を押すと記録が消え、次に不足したときは新しい項目として送られます。
          </p>
        </>
      ) : null}
    </>
  );
}

/** 判定から外した在庫があることを、理由ごとに示す。 */
function ExcludedLotsBadges({ shortage }: { shortage: ShortageResult }) {
  return (
    <>
      {shortage.unconvertibleLotCount > 0 ? (
        <Badge variant="outline" className="border-amber-300 text-amber-900 dark:text-amber-200">
          換算できない在庫{shortage.unconvertibleLotCount}件を除いて計算
        </Badge>
      ) : null}
      {shortage.expiredLotCount > 0 ? (
        <Badge variant="outline">期限切れ{shortage.expiredLotCount}件は数えない</Badge>
      ) : null}
    </>
  );
}
