/**
 * 開発用の初期データ。`pnpm db:seed`（= `prisma db seed`）で流す。
 *
 * 何度流しても同じ状態になるように、IDを固定してupsertする。
 * 在庫数量は`StockLot.quantity`へ直接書かず、入出庫履歴から
 * `computeLotQuantity()`で組み立てる。実装と同じ経路を通るので、
 * 集計値と履歴がずれたseedを作ってしまうことがない。
 */
import { PrismaClient, type Prisma } from "@prisma/client";

import { computeLotQuantity, type LedgerEntry } from "../src/lib/inventory/ledger.ts";
import { Decimal, type UnitCode } from "../src/lib/inventory/units.ts";

const prisma = new PrismaClient();

const HOUSEHOLD_ID = "seed-household";

/** seedが積む入出庫履歴。idとoccurredAtを固定してupsertできるようにする。 */
interface SeedTransaction {
  id: string;
  type: Prisma.InventoryTransactionCreateManyInput["type"];
  quantityDelta: string;
  occurredAt: string;
  note?: string;
  reversesTransactionId?: string;
}

interface SeedLot {
  id: string;
  productId: string;
  storageLocationId: string;
  storagePositionId?: string;
  unit: UnitCode;
  bestBeforeDate?: string;
  useByDate?: string;
  transactions: SeedTransaction[];
}

const CATEGORIES = [
  { id: "seed-category-food", name: "食材", kind: "FOOD" as const, sortOrder: 1 },
  { id: "seed-category-drink", name: "飲料", kind: "DRINK" as const, sortOrder: 2 },
  { id: "seed-category-daily", name: "日用品", kind: "DAILY" as const, sortOrder: 3 },
  { id: "seed-category-emergency", name: "防災用品", kind: "EMERGENCY" as const, sortOrder: 4 },
];

const STORAGE_LOCATIONS = [
  {
    id: "seed-location-fridge",
    name: "冷蔵庫",
    kind: "REFRIGERATOR" as const,
    temperatureZone: "CHILLED" as const,
    sortOrder: 1,
    positions: [
      { id: "seed-position-fridge-upper", name: "上段", sortOrder: 1 },
      { id: "seed-position-fridge-door", name: "ドアポケット", sortOrder: 2 },
    ],
  },
  {
    id: "seed-location-pantry",
    name: "パントリー",
    kind: "PANTRY" as const,
    temperatureZone: "AMBIENT" as const,
    sortOrder: 2,
    positions: [{ id: "seed-position-pantry-upper", name: "上棚", sortOrder: 1 }],
  },
  {
    id: "seed-location-emergency",
    name: "防災用品ストック",
    kind: "EMERGENCY_STOCK" as const,
    temperatureZone: "AMBIENT" as const,
    sortOrder: 3,
    positions: [],
  },
];

const PRODUCTS: Prisma.ProductCreateManyInput[] = [
  {
    id: "seed-product-milk",
    householdId: HOUSEHOLD_ID,
    categoryId: "seed-category-food",
    name: "牛乳",
    brand: "サンプル乳業",
    defaultUnit: "BOTTLE",
    contentAmount: new Decimal("1000"),
    contentUnit: "MILLILITER",
    temperatureZone: "CHILLED",
  },
  {
    id: "seed-product-egg",
    householdId: HOUSEHOLD_ID,
    categoryId: "seed-category-food",
    name: "卵",
    defaultUnit: "PIECE",
    temperatureZone: "CHILLED",
  },
  {
    id: "seed-product-water",
    householdId: HOUSEHOLD_ID,
    categoryId: "seed-category-drink",
    name: "天然水 2L",
    defaultUnit: "BOTTLE",
    contentAmount: new Decimal("2000"),
    contentUnit: "MILLILITER",
    temperatureZone: "AMBIENT",
    emergencyRole: "DRINKING_WATER",
  },
  {
    id: "seed-product-alpha-rice",
    householdId: HOUSEHOLD_ID,
    categoryId: "seed-category-emergency",
    name: "アルファ米",
    defaultUnit: "PACK",
    servingsPerUnit: new Decimal("1"),
    temperatureZone: "AMBIENT",
    requiresWater: true,
    emergencyRole: "STAPLE_FOOD",
  },
  {
    id: "seed-product-gas-cartridge",
    householdId: HOUSEHOLD_ID,
    categoryId: "seed-category-emergency",
    name: "カセットボンベ",
    defaultUnit: "PIECE",
    usesPerUnit: new Decimal("3"),
    temperatureZone: "AMBIENT",
    emergencyRole: "HEAT_SOURCE",
  },
  {
    id: "seed-product-toilet-paper",
    householdId: HOUSEHOLD_ID,
    categoryId: "seed-category-daily",
    name: "トイレットペーパー",
    defaultUnit: "ROLL",
    temperatureZone: "AMBIENT",
    emergencyRole: "SANITATION",
  },
];

const LOTS: SeedLot[] = [
  {
    id: "seed-lot-milk",
    productId: "seed-product-milk",
    storageLocationId: "seed-location-fridge",
    storagePositionId: "seed-position-fridge-door",
    unit: "BOTTLE",
    useByDate: "2026-09-12",
    transactions: [
      { id: "seed-tx-milk-1", type: "PURCHASE", quantityDelta: "2", occurredAt: "2026-09-05T10:00:00Z" },
      { id: "seed-tx-milk-2", type: "CONSUME", quantityDelta: "-1", occurredAt: "2026-09-06T23:00:00Z" },
    ],
  },
  {
    id: "seed-lot-egg",
    productId: "seed-product-egg",
    storageLocationId: "seed-location-fridge",
    storagePositionId: "seed-position-fridge-upper",
    unit: "PIECE",
    bestBeforeDate: "2026-09-18",
    transactions: [
      { id: "seed-tx-egg-1", type: "PURCHASE", quantityDelta: "10", occurredAt: "2026-09-05T10:00:00Z" },
      { id: "seed-tx-egg-2", type: "CONSUME", quantityDelta: "-3", occurredAt: "2026-09-06T08:00:00Z" },
      // 入力を間違えた消費を、履歴を消さずにREVERSALで取り消した例。
      {
        id: "seed-tx-egg-3",
        type: "REVERSAL",
        quantityDelta: "3",
        occurredAt: "2026-09-06T08:05:00Z",
        note: "個数を間違えたため取消",
        reversesTransactionId: "seed-tx-egg-2",
      },
      { id: "seed-tx-egg-4", type: "CONSUME", quantityDelta: "-2", occurredAt: "2026-09-06T08:06:00Z" },
    ],
  },
  {
    id: "seed-lot-water",
    productId: "seed-product-water",
    storageLocationId: "seed-location-emergency",
    unit: "BOTTLE",
    bestBeforeDate: "2028-03-31",
    transactions: [
      { id: "seed-tx-water-1", type: "PURCHASE", quantityDelta: "12", occurredAt: "2026-06-01T10:00:00Z" },
      // 棚卸で1本足りなかったぶんの訂正。
      {
        id: "seed-tx-water-2",
        type: "ADJUST",
        quantityDelta: "-1",
        occurredAt: "2026-09-01T12:00:00Z",
        note: "棚卸での訂正",
      },
    ],
  },
  {
    id: "seed-lot-alpha-rice",
    productId: "seed-product-alpha-rice",
    storageLocationId: "seed-location-emergency",
    unit: "PACK",
    bestBeforeDate: "2030-05-31",
    transactions: [
      { id: "seed-tx-rice-1", type: "PURCHASE", quantityDelta: "15", occurredAt: "2026-05-20T10:00:00Z" },
    ],
  },
  {
    id: "seed-lot-gas-cartridge",
    productId: "seed-product-gas-cartridge",
    storageLocationId: "seed-location-emergency",
    unit: "PIECE",
    transactions: [
      { id: "seed-tx-gas-1", type: "PURCHASE", quantityDelta: "6", occurredAt: "2026-05-20T10:00:00Z" },
      { id: "seed-tx-gas-2", type: "DISPOSE", quantityDelta: "-1", occurredAt: "2026-08-10T10:00:00Z", note: "錆びていたため廃棄" },
    ],
  },
  {
    id: "seed-lot-toilet-paper",
    productId: "seed-product-toilet-paper",
    storageLocationId: "seed-location-pantry",
    storagePositionId: "seed-position-pantry-upper",
    unit: "ROLL",
    transactions: [
      { id: "seed-tx-tp-1", type: "PURCHASE", quantityDelta: "12", occurredAt: "2026-08-01T10:00:00Z" },
      { id: "seed-tx-tp-2", type: "CONSUME", quantityDelta: "-2.5", occurredAt: "2026-09-01T10:00:00Z" },
    ],
  },
];

function toLedgerEntries(lot: SeedLot): LedgerEntry[] {
  return lot.transactions.map((transaction) => ({
    id: transaction.id,
    type: transaction.type,
    quantityDelta: new Decimal(transaction.quantityDelta),
    unit: lot.unit,
    reversesTransactionId: transaction.reversesTransactionId ?? null,
  }));
}

async function main(): Promise<void> {
  await prisma.household.upsert({
    where: { id: HOUSEHOLD_ID },
    update: { name: "サンプル家庭" },
    create: { id: HOUSEHOLD_ID, name: "サンプル家庭" },
  });

  await prisma.member.upsert({
    where: { id: "seed-member-owner" },
    update: { displayName: "自分", role: "OWNER" },
    create: {
      id: "seed-member-owner",
      householdId: HOUSEHOLD_ID,
      displayName: "自分",
      role: "OWNER",
    },
  });

  for (const category of CATEGORIES) {
    const { id, ...rest } = category;
    await prisma.category.upsert({
      where: { id },
      update: rest,
      create: { id, householdId: HOUSEHOLD_ID, ...rest },
    });
  }

  for (const location of STORAGE_LOCATIONS) {
    const { id, positions, ...rest } = location;
    await prisma.storageLocation.upsert({
      where: { id },
      update: rest,
      create: { id, householdId: HOUSEHOLD_ID, ...rest },
    });

    for (const position of positions) {
      const { id: positionId, ...positionRest } = position;
      await prisma.storagePosition.upsert({
        where: { id: positionId },
        update: positionRest,
        create: {
          id: positionId,
          householdId: HOUSEHOLD_ID,
          storageLocationId: id,
          ...positionRest,
        },
      });
    }
  }

  for (const product of PRODUCTS) {
    const { id, householdId, ...rest } = product;
    await prisma.product.upsert({
      where: { id: id as string },
      update: rest,
      create: { id, householdId, ...rest },
    });
  }

  for (const lot of LOTS) {
    // 数量は履歴から組み立てる。ここでの再計算がそのまま集計値の正しさの担保になる。
    const quantity = computeLotQuantity(toLedgerEntries(lot), lot.unit).amount;
    const lotFields = {
      productId: lot.productId,
      storageLocationId: lot.storageLocationId,
      storagePositionId: lot.storagePositionId ?? null,
      unit: lot.unit,
      quantity,
      bestBeforeDate: lot.bestBeforeDate ? new Date(lot.bestBeforeDate) : null,
      useByDate: lot.useByDate ? new Date(lot.useByDate) : null,
      status: quantity.lessThanOrEqualTo(new Decimal(0)) ? ("DEPLETED" as const) : ("ACTIVE" as const),
    };

    await prisma.stockLot.upsert({
      where: { id: lot.id },
      update: lotFields,
      create: { id: lot.id, householdId: HOUSEHOLD_ID, ...lotFields },
    });

    // 取消行は取消対象より後に入れる必要がある（外部キーが自己参照のため）。
    for (const transaction of lot.transactions) {
      const fields = {
        stockLotId: lot.id,
        productId: lot.productId,
        memberId: "seed-member-owner",
        type: transaction.type,
        quantityDelta: new Decimal(transaction.quantityDelta),
        unit: lot.unit,
        reversesTransactionId: transaction.reversesTransactionId ?? null,
        occurredAt: new Date(transaction.occurredAt),
        note: transaction.note ?? null,
      };

      await prisma.inventoryTransaction.upsert({
        where: { id: transaction.id },
        update: fields,
        create: { id: transaction.id, householdId: HOUSEHOLD_ID, ...fields },
      });
    }
  }

  const lotCount = await prisma.stockLot.count({ where: { householdId: HOUSEHOLD_ID } });
  const transactionCount = await prisma.inventoryTransaction.count({
    where: { householdId: HOUSEHOLD_ID },
  });
  console.log(`seed完了: 在庫ロット ${lotCount}件 / 入出庫履歴 ${transactionCount}件`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
