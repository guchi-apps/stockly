/**
 * 補充の読み取り。
 *
 * 在庫側と同じく、**画面から`db.*.findMany()`を直接呼ばず必ずここを通す。** どの関数も先頭で
 * `scopeToHousehold()`を通し、そこで返った`householdId`だけをwhereに使う。
 *
 * 判定そのものは`shortage.ts`の純関数が行い、ここは「どの在庫がどの基準の対象か」を
 * 割り当てて渡すところまでを受け持つ。家庭1つぶんの在庫はせいぜい数百件なので、
 * 在庫は1回引いてからメモリ上で仕分ける（基準ごとにクエリを投げない）。
 */
import { db } from "@/lib/db";
import { scopeToHousehold } from "@/lib/household/access";
import { householdMembershipStore } from "@/lib/household/store";
import { resolveExpiry } from "@/lib/inventory/operations";
import type { InventoryContext } from "@/lib/inventory/service";
import { Decimal, type Quantity, type UnitCode } from "@/lib/inventory/units";

import {
  calculateShortages,
  compareByShortage,
  type ReplenishmentRuleSnapshot,
  type ShortageResult,
  type StockSnapshot,
} from "./shortage.ts";

async function scope(ctx: InventoryContext): Promise<string> {
  const { householdId } = await scopeToHousehold(
    householdMembershipStore,
    ctx.userId,
    ctx.householdId,
  );
  return householdId;
}

const RULE_SELECT = {
  id: true,
  productId: true,
  categoryId: true,
  thresholdAmount: true,
  targetAmount: true,
  unit: true,
  enabled: true,
  product: { select: { id: true, name: true, brand: true } },
  category: { select: { id: true, name: true } },
} as const;

export type ReplenishmentRuleRow = Awaited<ReturnType<typeof listReplenishmentRules>>[number];

/** 補充基準の一覧。対象の名前で並べる。 */
export async function listReplenishmentRules(ctx: InventoryContext) {
  const householdId = await scope(ctx);

  const rules = await db.replenishmentRule.findMany({
    where: { householdId },
    select: RULE_SELECT,
  });

  return rules
    .map((rule) => ({ ...rule, targetName: targetNameOf(rule) }))
    .sort((a, b) => a.targetName.localeCompare(b.targetName, "ja"));
}

function targetNameOf(rule: {
  product: { name: string } | null;
  category: { name: string } | null;
}): string {
  return rule.product?.name ?? rule.category?.name ?? "（対象が見つかりません）";
}

export type ShoppingListEntryRow = Awaited<ReturnType<typeof listShoppingListEntries>>[number];

/** Notionへ送った記録。新しく動いたものから並べる。 */
export async function listShoppingListEntries(ctx: InventoryContext) {
  const householdId = await scope(ctx);

  return db.shoppingListEntry.findMany({
    where: { householdId },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      name: true,
      shortageAmount: true,
      unit: true,
      status: true,
      notionPageId: true,
      notionUrl: true,
      lastError: true,
      lastSentAt: true,
      updatedAt: true,
    },
  });
}

/**
 * 有効な基準を判定に使える形へ読み出し、対象ごとの在庫と一緒に返す。
 *
 * カテゴリの基準が数えるのは、**そのカテゴリに直接属する商品**の在庫だけ。
 * 子カテゴリまで辿らないのは、「飲料」の基準が「飲料 > お茶」の在庫まで含むかどうかを
 * 画面から確かめられないため（意図を隠したまま合計を膨らませない）。
 */
export async function loadShortageInputs(ctx: InventoryContext): Promise<{
  rules: ReplenishmentRuleSnapshot[];
  lotsByRuleId: Map<string, StockSnapshot[]>;
}> {
  const householdId = await scope(ctx);

  const [rules, lots] = await Promise.all([
    db.replenishmentRule.findMany({
      where: { householdId, enabled: true },
      select: RULE_SELECT,
    }),
    db.stockLot.findMany({
      where: { householdId, status: "ACTIVE" },
      select: {
        quantity: true,
        unit: true,
        bestBeforeDate: true,
        useByDate: true,
        productId: true,
        // 内容量・食数・使用回数は「1本 = 2L」「1パック = 1食」のような、単位の壁を越えた
        // 換算に使う（shortage.tsのtoRuleUnit）。
        product: {
          select: {
            categoryId: true,
            contentAmount: true,
            contentUnit: true,
            servingsPerUnit: true,
            usesPerUnit: true,
          },
        },
      },
    }),
  ]);

  const today = new Date();
  const snapshots = lots.map((lot) => ({
    productId: lot.productId,
    categoryId: lot.product.categoryId,
    snapshot: {
      amount: new Decimal(lot.quantity),
      unit: lot.unit,
      expired: resolveExpiry(lot, today).status === "EXPIRED",
      perUnitEquivalents: perUnitEquivalentsOf(lot.product),
    } satisfies StockSnapshot,
  }));

  const lotsByRuleId = new Map<string, StockSnapshot[]>();

  const snapshotRules: ReplenishmentRuleSnapshot[] = [];

  for (const rule of rules) {
    const target = rule.productId
      ? ({ kind: "PRODUCT", id: rule.productId, name: targetNameOf(rule) } as const)
      : rule.categoryId
        ? ({ kind: "CATEGORY", id: rule.categoryId, name: targetNameOf(rule) } as const)
        : null;
    // 対象を持たない基準は作れないが、直接DBを触られた場合に判定へ混ぜない。
    if (!target) continue;

    snapshotRules.push({
      ruleId: rule.id,
      target,
      thresholdAmount: new Decimal(rule.thresholdAmount),
      targetAmount: new Decimal(rule.targetAmount),
      unit: rule.unit,
    });

    lotsByRuleId.set(
      rule.id,
      snapshots
        .filter((lot) =>
          target.kind === "PRODUCT" ? lot.productId === target.id : lot.categoryId === target.id,
        )
        .map((lot) => lot.snapshot),
    );
  }

  return { rules: snapshotRules, lotsByRuleId };
}

/**
 * 商品が持つ「1単位あたり」の値を、換算に使える形へ並べる。
 *
 * 持っていない値は並べない（＝その次元の基準では、この在庫は数えられない）。
 */
function perUnitEquivalentsOf(product: {
  contentAmount: Decimal | null;
  contentUnit: UnitCode | null;
  servingsPerUnit: Decimal | null;
  usesPerUnit: Decimal | null;
}): Quantity[] {
  const equivalents: Quantity[] = [];

  if (product.contentAmount && product.contentUnit) {
    equivalents.push({ amount: new Decimal(product.contentAmount), unit: product.contentUnit });
  }
  if (product.servingsPerUnit) {
    equivalents.push({ amount: new Decimal(product.servingsPerUnit), unit: "SERVING" });
  }
  if (product.usesPerUnit) {
    equivalents.push({ amount: new Decimal(product.usesPerUnit), unit: "USE" });
  }

  return equivalents;
}

/** 全基準の判定結果（不足の大きい順）。 */
export async function listShortages(ctx: InventoryContext): Promise<ShortageResult[]> {
  const { rules, lotsByRuleId } = await loadShortageInputs(ctx);
  return calculateShortages(rules, lotsByRuleId).sort(compareByShortage);
}

/** 補充の画面が一度に必要とするもの。 */
export async function loadReplenishmentOverview(ctx: InventoryContext) {
  const [results, entries] = await Promise.all([listShortages(ctx), listShoppingListEntries(ctx)]);

  return {
    results,
    shortages: results.filter((result) => result.isShort),
    entries,
  };
}

/**
 * 基準の対象として選べる商品・カテゴリ。
 *
 * すでに基準がある対象は選択肢から外す（1対象1基準のため、選べても保存でエラーになるだけ）。
 */
export async function listRuleTargetOptions(ctx: InventoryContext) {
  const householdId = await scope(ctx);

  const [products, categories, rules] = await Promise.all([
    db.product.findMany({
      where: { householdId },
      orderBy: [{ name: "asc" }],
      select: { id: true, name: true, brand: true, defaultUnit: true },
    }),
    db.category.findMany({
      where: { householdId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    db.replenishmentRule.findMany({
      where: { householdId },
      select: { productId: true, categoryId: true },
    }),
  ]);

  const usedProductIds = new Set(rules.map((rule) => rule.productId).filter(Boolean));
  const usedCategoryIds = new Set(rules.map((rule) => rule.categoryId).filter(Boolean));

  return {
    products: products.filter((product) => !usedProductIds.has(product.id)),
    categories: categories.filter((category) => !usedCategoryIds.has(category.id)),
  };
}
