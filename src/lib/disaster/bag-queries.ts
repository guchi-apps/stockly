/**
 * 防災バッグの点検の読み書き（#8）。
 *
 * **バッグの実体は保管場所（`StorageLocation`で種別が`EMERGENCY_STOCK`のもの）**で、
 * 中身は普通の在庫（`StockLot`）そのもの。防災用の別在庫は作らない。
 *
 * 判定は`assess.ts`の`assessDisasterStock()`をそのまま呼ぶ。ここが変えるのは
 * **目標（人数・日数）だけ**で、必要量の出し方も除外の条件も家庭の判定と同じものを使う
 * （受入条件の「UI内に別ルールを重複実装しない」）。
 *
 * 在庫側と同じく、画面から`db.*.findMany()`を直接呼ばず必ずここを通す。
 * 先頭で`scopeToHousehold()`を通し、そこで返った`householdId`だけをwhereに使う。
 */
import { db } from "@/lib/db";
import { scopeToHousehold } from "@/lib/household/access";
import { householdMembershipStore } from "@/lib/household/store";
import { resolveExpiry } from "@/lib/inventory/operations";
import type { InventoryContext } from "@/lib/inventory/service";
import { readExpirySettings, toExpiryPolicy } from "@/lib/inventory/settings";
import { Decimal, type UnitCode } from "@/lib/inventory/units";
import { tokyoToday } from "@/lib/time/tokyo";

import {
  assessDisasterStock,
  type DisasterAssessment,
  type DisasterLotSnapshot,
  type DisasterLotVerdict,
} from "./assess.ts";
import {
  attentionRank,
  countForInspection,
  needsInspection,
  resolveInspectionState,
  summarizeAttention,
  toBagPlan,
  DEFAULT_DISASTER_BAG_PLAN,
  type BagAttentionGroup,
  type BagInspectionFormValue,
  type BagItem,
  type DisasterBagPlanValue,
  type InspectionState,
} from "./bag.ts";
import { perUnitEquivalentsOf } from "./queries.ts";
import { categoryOfRole, DISASTER_RULE_VERSION, type DisasterCategory } from "./rules.ts";
import { readDisasterPlanSettings } from "./settings.ts";

async function scope(ctx: InventoryContext): Promise<string> {
  const { householdId } = await scopeToHousehold(
    householdMembershipStore,
    ctx.userId,
    ctx.householdId,
  );
  return householdId;
}

/** バッグの中身1件。点検の観点（`BagItem`）に、画面へ出す実量と判定の結果を足したもの。 */
export interface DisasterBagContentItem extends BagItem {
  readonly amount: Decimal;
  readonly unit: UnitCode;
  readonly note: string | null;
  /** どの区分の候補か。防災の役割を持たない商品は`null`（集計の対象外）。 */
  readonly category: DisasterCategory | null;
  /** 集計の判定結果。対象外の在庫は`null`。 */
  readonly verdict: DisasterLotVerdict | null;
}

/** 一覧に出すバッグ1件ぶん。 */
export interface DisasterBagSummary {
  readonly storageLocationId: string;
  readonly name: string;
  readonly plan: DisasterBagPlanValue;
  readonly isDefaultPlan: boolean;
  readonly itemCount: number;
  readonly attention: readonly BagAttentionGroup[];
  readonly inspection: InspectionState;
  /** 目標に届いていない区分の数。 */
  readonly shortageCategoryCount: number;
}

/** 点検の画面が一度に必要とするもの。 */
export interface DisasterBagDetail extends DisasterBagSummary {
  readonly assessment: DisasterAssessment;
  readonly contents: readonly DisasterBagContentItem[];
  readonly inspections: readonly {
    id: string;
    inspectedOn: Date;
    note: string | null;
    itemCount: number;
    expiredCount: number;
    expiringSoonCount: number;
    unknownExpiryCount: number;
    ruleVersion: string;
  }[];
}

const LOT_SELECT = {
  id: true,
  quantity: true,
  unit: true,
  bestBeforeDate: true,
  useByDate: true,
  noExpiry: true,
  openedAt: true,
  note: true,
  storageLocationId: true,
  storageLocation: { select: { temperatureZone: true } },
  product: {
    select: {
      name: true,
      emergencyRole: true,
      temperatureZone: true,
      requiresHeating: true,
      requiresWater: true,
      contentAmount: true,
      contentUnit: true,
      servingsPerUnit: true,
      usesPerUnit: true,
    },
  },
} as const;

type LotRow = {
  id: string;
  quantity: Decimal;
  unit: UnitCode;
  bestBeforeDate: Date | null;
  useByDate: Date | null;
  noExpiry: boolean;
  openedAt: Date | null;
  note: string | null;
  storageLocationId: string | null;
  storageLocation: { temperatureZone: "AMBIENT" | "CHILLED" | "FROZEN" } | null;
  product: {
    name: string;
    emergencyRole: DisasterLotSnapshot["role"];
    temperatureZone: "AMBIENT" | "CHILLED" | "FROZEN";
    requiresHeating: boolean;
    requiresWater: boolean;
    contentAmount: Decimal | null;
    contentUnit: UnitCode | null;
    servingsPerUnit: Decimal | null;
    usesPerUnit: Decimal | null;
  };
};

function toSnapshot(
  lot: LotRow,
  expiry: DisasterLotSnapshot["expiry"],
  amount: Decimal,
): DisasterLotSnapshot {
  return {
    lotId: lot.id,
    productName: lot.product.name,
    amount,
    unit: lot.unit,
    role: lot.product.emergencyRole,
    productZone: lot.product.temperatureZone,
    storageZone: lot.storageLocation?.temperatureZone ?? null,
    requiresHeating: lot.product.requiresHeating,
    requiresWater: lot.product.requiresWater,
    opened: lot.openedAt !== null,
    expiry,
    perUnitEquivalents: perUnitEquivalentsOf(lot.product),
  };
}

/**
 * 保管場所1つぶんの在庫を、点検に使える形へ組み替える。
 *
 * **防災の役割を持たない在庫も落とさずに返す。** ガムテープのように集計へは効かないものも
 * バッグの中身であることに変わりはなく、点検では「入っているのに数えていない」ことを
 * 見せる必要がある（`/disaster`の集計が役割で絞るのとはここが違う）。
 */
function buildContents(
  lots: readonly LotRow[],
  now: Date,
  policy: Parameters<typeof resolveExpiry>[2],
): { contents: DisasterBagContentItem[]; snapshots: DisasterLotSnapshot[] } {
  const snapshots: DisasterLotSnapshot[] = [];
  const contents: DisasterBagContentItem[] = [];

  for (const lot of lots) {
    const amount = new Decimal(lot.quantity);
    const expiry = resolveExpiry(lot, now, policy);
    const category = categoryOfRole(lot.product.emergencyRole);
    if (category) snapshots.push(toSnapshot(lot, expiry, amount));

    contents.push({
      lotId: lot.id,
      productName: lot.product.name,
      hasQuantity: amount.greaterThan(0),
      opened: lot.openedAt !== null,
      expiry,
      amount,
      unit: lot.unit,
      note: lot.note,
      category,
      verdict: null,
    });
  }

  return { contents, snapshots };
}

/** 判定の結果を中身の各行へ結び直す。 */
function attachVerdicts(
  contents: DisasterBagContentItem[],
  assessment: DisasterAssessment,
): DisasterBagContentItem[] {
  const byLot = new Map<string, DisasterLotVerdict>();
  for (const category of assessment.categories) {
    for (const verdict of [...category.includedLots, ...category.excludedLots]) {
      byLot.set(verdict.lot.lotId, verdict);
    }
  }
  return contents
    .map((item) => ({ ...item, verdict: byLot.get(item.lotId) ?? null }))
    // 手当てが要るものを先に、同じ順位のものは商品名で並べる（開くたびに順番が変わらないように）。
    .sort(
      (a, b) =>
        attentionRank(a) - attentionRank(b) || a.productName.localeCompare(b.productName, "ja"),
    );
}

function toBagPlanValue(row: {
  peopleCount: number;
  targetDays: number;
  inspectionIntervalDays: number;
} | null): { plan: DisasterBagPlanValue; isDefault: boolean } {
  if (!row) return { plan: DEFAULT_DISASTER_BAG_PLAN, isDefault: true };
  return {
    plan: {
      peopleCount: row.peopleCount,
      targetDays: row.targetDays,
      inspectionIntervalDays: row.inspectionIntervalDays,
    },
    isDefault: false,
  };
}

/**
 * 防災バッグの一覧。
 *
 * **点検が要るもの（未点検・期限切れ）を先に出す。** そのあとは保管場所の並び順に従う。
 */
export async function listDisasterBags(
  ctx: InventoryContext,
  now: Date = new Date(),
): Promise<DisasterBagSummary[]> {
  const householdId = await scope(ctx);
  const today = tokyoToday(now);

  const [locations, householdSettings, expirySettings] = await Promise.all([
    db.storageLocation.findMany({
      where: { householdId, kind: "EMERGENCY_STOCK" },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        disasterBag: {
          select: {
            peopleCount: true,
            targetDays: true,
            inspectionIntervalDays: true,
            inspections: {
              orderBy: { inspectedOn: "desc" },
              take: 1,
              select: { inspectedOn: true },
            },
          },
        },
      },
    }),
    readDisasterPlanSettings(householdId),
    readExpirySettings(householdId),
  ]);
  if (locations.length === 0) return [];

  const policy = toExpiryPolicy(expirySettings);
  const lots = (await db.stockLot.findMany({
    where: {
      householdId,
      status: "ACTIVE",
      storageLocationId: { in: locations.map((location) => location.id) },
    },
    select: LOT_SELECT,
  })) as unknown as LotRow[];

  const byLocation = new Map<string, LotRow[]>();
  for (const location of locations) byLocation.set(location.id, []);
  for (const lot of lots) {
    if (lot.storageLocationId) byLocation.get(lot.storageLocationId)?.push(lot);
  }

  const summaries = locations.map((location) => {
    const { plan, isDefault } = toBagPlanValue(location.disasterBag);
    const { contents, snapshots } = buildContents(
      byLocation.get(location.id) ?? [],
      now,
      policy,
    );
    const assessment = assessDisasterStock(snapshots, toBagPlan(householdSettings.plan, plan));

    return {
      storageLocationId: location.id,
      name: location.name,
      plan,
      isDefaultPlan: isDefault,
      itemCount: contents.length,
      attention: summarizeAttention(contents),
      inspection: resolveInspectionState(
        location.disasterBag?.inspections[0]?.inspectedOn ?? null,
        plan.inspectionIntervalDays,
        today,
      ),
      shortageCategoryCount: assessment.categories.filter((category) => !category.isMet).length,
    } satisfies DisasterBagSummary;
  });

  return summaries.sort((a, b) => Number(needsInspection(b.inspection)) - Number(needsInspection(a.inspection)));
}

/** 点検の画面1枚ぶん。保管場所が無い・防災用品でない場合は`null`。 */
export async function getDisasterBag(
  ctx: InventoryContext,
  storageLocationId: string,
  now: Date = new Date(),
): Promise<DisasterBagDetail | null> {
  const householdId = await scope(ctx);
  const today = tokyoToday(now);

  const location = await db.storageLocation.findFirst({
    where: { householdId, id: storageLocationId, kind: "EMERGENCY_STOCK" },
    select: {
      id: true,
      name: true,
      disasterBag: {
        select: {
          peopleCount: true,
          targetDays: true,
          inspectionIntervalDays: true,
          inspections: {
            orderBy: [{ inspectedOn: "desc" }, { createdAt: "desc" }],
            take: 10,
            select: {
              id: true,
              inspectedOn: true,
              note: true,
              itemCount: true,
              expiredCount: true,
              expiringSoonCount: true,
              unknownExpiryCount: true,
              ruleVersion: true,
            },
          },
        },
      },
    },
  });
  if (!location) return null;

  const [householdSettings, expirySettings, lots] = await Promise.all([
    readDisasterPlanSettings(householdId),
    readExpirySettings(householdId),
    db.stockLot.findMany({
      where: { householdId, status: "ACTIVE", storageLocationId: location.id },
      orderBy: { createdAt: "asc" },
      select: LOT_SELECT,
    }) as unknown as Promise<LotRow[]>,
  ]);

  const { plan, isDefault } = toBagPlanValue(location.disasterBag);
  const { contents, snapshots } = buildContents(lots, now, toExpiryPolicy(expirySettings));
  const assessment = assessDisasterStock(snapshots, toBagPlan(householdSettings.plan, plan));
  const inspections = location.disasterBag?.inspections ?? [];

  return {
    storageLocationId: location.id,
    name: location.name,
    plan,
    isDefaultPlan: isDefault,
    itemCount: contents.length,
    attention: summarizeAttention(contents),
    inspection: resolveInspectionState(
      inspections[0]?.inspectedOn ?? null,
      plan.inspectionIntervalDays,
      today,
    ),
    shortageCategoryCount: assessment.categories.filter((category) => !category.isMet).length,
    assessment,
    contents: attachVerdicts(contents, assessment),
    inspections,
  };
}

/** 防災ストックの画面に出す帯。点検が要るバッグがあるときだけ中身が入る。 */
export async function getInspectionAlert(
  ctx: InventoryContext,
  now: Date = new Date(),
): Promise<{ total: number; needsInspection: DisasterBagSummary[] }> {
  const bags = await listDisasterBags(ctx, now);
  return { total: bags.length, needsInspection: bags.filter((bag) => needsInspection(bag.inspection)) };
}

/**
 * バッグの基準を保存する。行が無ければ作る。
 *
 * 保管場所が家庭のものであることは`storageLocation.findFirst()`で確かめる。
 * DB側でも`[householdId, storageLocationId]`の複合外部キーが同じ保証を持つ。
 */
export async function saveDisasterBagPlan(
  ctx: InventoryContext,
  storageLocationId: string,
  value: DisasterBagPlanValue,
): Promise<void> {
  const householdId = await scope(ctx);
  await ensureBag(householdId, storageLocationId, value);
}

async function ensureBag(
  householdId: string,
  storageLocationId: string,
  value: DisasterBagPlanValue | null,
): Promise<string> {
  const location = await db.storageLocation.findFirst({
    where: { householdId, id: storageLocationId, kind: "EMERGENCY_STOCK" },
    select: { id: true },
  });
  if (!location) throw new Error("防災バッグが見つかりません。");

  const bag = await db.disasterBag.upsert({
    where: { householdId_storageLocationId: { householdId, storageLocationId } },
    create: { householdId, storageLocationId, ...(value ?? DEFAULT_DISASTER_BAG_PLAN) },
    update: value ?? {},
    select: { id: true },
  });
  return bag.id;
}

/**
 * 点検を記録する。
 *
 * **件数は保存の直前に在庫から数え直す。** 画面が開かれてから記録するまでのあいだに
 * 在庫が動いていることがあり、画面に出ていた数字をそのまま送ると、見ていない状態を
 * 記録することになる。
 */
export async function recordBagInspection(
  ctx: InventoryContext,
  storageLocationId: string,
  value: BagInspectionFormValue,
  now: Date = new Date(),
): Promise<void> {
  const householdId = await scope(ctx);
  const bagId = await ensureBag(householdId, storageLocationId, null);

  const [expirySettings, lots] = await Promise.all([
    readExpirySettings(householdId),
    db.stockLot.findMany({
      where: { householdId, status: "ACTIVE", storageLocationId },
      select: LOT_SELECT,
    }) as unknown as Promise<LotRow[]>,
  ]);
  const { contents } = buildContents(lots, now, toExpiryPolicy(expirySettings));

  await db.disasterBagInspection.create({
    data: {
      householdId,
      disasterBagId: bagId,
      inspectedOn: value.inspectedOn,
      note: value.note,
      ruleVersion: DISASTER_RULE_VERSION,
      ...countForInspection(contents),
    },
  });
}
