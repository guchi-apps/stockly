import Link from "next/link";
import { notFound } from "next/navigation";
import { ShoppingCart } from "lucide-react";

import {
  deleteReplenishmentRuleAction,
  toggleReplenishmentRuleAction,
  updateReplenishmentRuleAction,
} from "@/app/(app)/replenishment/actions";
import { ActionNotice, PageHeader, firstValue } from "@/components/inventory/chrome";
import { SubmitButton } from "@/components/inventory/submit-button";
import { ReplenishmentRuleForm } from "@/components/replenishment/rule-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireInventoryContext } from "@/lib/inventory/context";
import { UNIT_DEFINITIONS } from "@/lib/inventory/units";
import { listReplenishmentRules, listRuleTargetOptions } from "@/lib/replenishment/queries";
import { formatTargetRef } from "@/lib/replenishment/rules";
import { TARGET_KIND_LABELS, describeRule } from "@/lib/replenishment/shortage";

export default async function ReplenishmentRulesPage({
  searchParams,
}: PageProps<"/replenishment/rules">) {
  const query = await searchParams;
  const { ctx } = await requireInventoryContext();
  if (!ctx) notFound();

  const [rules, options] = await Promise.all([
    listReplenishmentRules(ctx),
    listRuleTargetOptions(ctx),
  ]);

  return (
    <>
      <PageHeader
        title="補充基準"
        description="この数量を下回ったら、目標数量まで買い足す候補にします"
        actions={
          <Button asChild variant="outline" size="lg">
            <Link href="/replenishment">
              <ShoppingCart className="size-4" aria-hidden />
              補充候補
            </Link>
          </Button>
        }
      />

      <ActionNotice notice={firstValue(query.notice)} error={firstValue(query.error)} />

      {rules.length === 0 ? (
        <p className="text-muted-foreground px-4 py-6 text-sm md:px-6">
          まだ基準がありません。下のフォームで「これ以下になったら、いくつまで買い足すか」を決めると、
          不足したときに補充の画面へ候補が出ます。
        </p>
      ) : (
        <ul>
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="flex flex-col gap-2 border-b px-4 py-4 md:flex-row md:items-center md:px-6"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold">{rule.targetName}</p>
                <p className="text-muted-foreground text-xs">{describeRule(rule)}</p>
                <span className="mt-1.5 flex flex-wrap gap-1.5">
                  <Badge variant="outline">
                    {TARGET_KIND_LABELS[rule.productId ? "PRODUCT" : "CATEGORY"]}
                  </Badge>
                  <Badge variant="outline">判定単位: {UNIT_DEFINITIONS[rule.unit].label}</Badge>
                  {rule.enabled ? null : <Badge variant="secondary">停止中</Badge>}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* 数量だけをその場で直せるようにする（対象と単位を変えるのは別の基準にあたる）。 */}
                <form
                  action={updateReplenishmentRuleAction}
                  className="flex flex-wrap items-center gap-2"
                >
                  <input type="hidden" name="ruleId" value={rule.id} />
                  <Input
                    name="thresholdAmount"
                    inputMode="decimal"
                    defaultValue={rule.thresholdAmount.toDecimalPlaces(3).toString()}
                    aria-label={`${rule.targetName}の補充基準`}
                    className="h-10 w-24 text-base"
                  />
                  <span className="text-muted-foreground text-xs">以下 →</span>
                  <Input
                    name="targetAmount"
                    inputMode="decimal"
                    defaultValue={rule.targetAmount.toDecimalPlaces(3).toString()}
                    aria-label={`${rule.targetName}の目標数量`}
                    className="h-10 w-24 text-base"
                  />
                  <SubmitButton className="h-10" pendingLabel="保存中…">
                    保存
                  </SubmitButton>
                </form>

                <form action={toggleReplenishmentRuleAction}>
                  <input type="hidden" name="ruleId" value={rule.id} />
                  <input type="hidden" name="enabled" value={rule.enabled ? "off" : "on"} />
                  <SubmitButton variant="ghost" className="text-muted-foreground h-10">
                    {rule.enabled ? "候補から外す" : "候補に戻す"}
                  </SubmitButton>
                </form>

                <form action={deleteReplenishmentRuleAction}>
                  <input type="hidden" name="ruleId" value={rule.id} />
                  <SubmitButton variant="ghost" className="text-muted-foreground h-10">
                    削除
                  </SubmitButton>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ReplenishmentRuleForm
        products={options.products.map((product) => ({
          value: formatTargetRef("PRODUCT", product.id),
          label: product.brand ? `${product.name}（${product.brand}）` : product.name,
          defaultUnit: product.defaultUnit,
        }))}
        categories={options.categories.map((category) => ({
          value: formatTargetRef("CATEGORY", category.id),
          label: category.name,
        }))}
      />
    </>
  );
}
