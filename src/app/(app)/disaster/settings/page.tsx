import Link from "next/link";
import { ArrowLeft, LifeBuoy } from "lucide-react";

import { saveDisasterPlanAction } from "@/app/(app)/disaster/actions";
import { DisasterPlanSettingsForm } from "@/components/disaster/plan-settings-form";
import { ActionNotice, EmptyState, PageHeader, firstValue } from "@/components/inventory/chrome";
import { Button } from "@/components/ui/button";
import { getDisasterPlanSettings } from "@/lib/disaster/settings";
import { DISASTER_RULE_VERSION } from "@/lib/disaster/rules";
import { requireInventoryContext } from "@/lib/inventory/context";

export default async function DisasterSettingsPage({
  searchParams,
}: PageProps<"/disaster/settings">) {
  const params = await searchParams;
  const { ctx, householdName } = await requireInventoryContext();

  if (!ctx) {
    return (
      <EmptyState
        icon={<LifeBuoy className="size-8" />}
        title="家庭が見つかりません"
        description="基準は家庭ごとに保存します。ログインし直しても表示されない場合は、管理者に連絡してください。"
      />
    );
  }

  const { plan, isDefault } = await getDisasterPlanSettings(ctx);

  return (
    <>
      <PageHeader
        title="防災の基準"
        description={`${householdName ? `${householdName} ・ ` : ""}家族全員に同じ基準が効きます`}
        actions={
          <Button asChild variant="ghost">
            <Link href="/disaster">
              <ArrowLeft className="size-4" aria-hidden />
              防災ストック
            </Link>
          </Button>
        }
      />

      <ActionNotice notice={firstValue(params.notice)} error={firstValue(params.error)} />

      <DisasterPlanSettingsForm
        action={saveDisasterPlanAction}
        ruleVersion={DISASTER_RULE_VERSION}
        isDefault={isDefault}
        initial={{
          peopleCount: String(plan.peopleCount),
          targetDays: String(plan.targetDays),
          waterLitersPerPersonDay: plan.waterLitersPerPersonDay.toString(),
          foodServingsPerPersonDay: plan.foodServingsPerPersonDay.toString(),
          sanitationUsesPerPersonDay: plan.sanitationUsesPerPersonDay.toString(),
          lightingUnitsPerPerson: plan.lightingUnitsPerPerson.toString(),
          powerUnitsPerPerson: plan.powerUnitsPerPerson.toString(),
          heatSourceUsesPerDay: plan.heatSourceUsesPerDay.toString(),
          includeChilled: plan.includeChilled,
          includeFrozen: plan.includeFrozen,
          includeOpened: plan.includeOpened,
          requireHeatSourceForHeating: plan.requireHeatSourceForHeating,
          requireWaterForRehydration: plan.requireWaterForRehydration,
        }}
      />
    </>
  );
}
