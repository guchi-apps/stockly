/**
 * Issue #4の受入条件に挙がっている在庫を、そのまま画面で確かめられる形で投入する。
 * `pnpm db:seed:fixture` で流す（開発・確認用。実在の家庭のデータではない）。
 *
 * 投入先は開発用ログインが入る家庭（`dev-household-own`）で、`prisma/seed.ts`と同じ。
 * あちらが「モデルが一通り動くこと」を見せるサンプルなのに対し、こちらは
 * **受入条件の読み合わせに使う一式**で、次を必ず含む。
 *
 * - 防災バッグ1個（玄関収納に置いた本体）と、その中身
 * - トイレットペーパー0.4ロール（使いかけ）・携帯トイレ3回分・ウェットティッシュ・
 *   ガムテープ・ゴミ袋3枚・小型ライト
 * - 未開封の水10L（2L×5本）と、飲みかけ1本
 * - カップ麺2個
 * - 期限切れのサトウのごはん4パック
 * - バーコード4件と、そのうち3件ぶんの学習ルール（#9）。1件は誤紐付けの疑いが立った状態にしてある
 *
 * 防災の判定（#7）を画面で確かめられるよう、6区分（食料・飲料・衛生・照明・電源・熱源）が
 * すべて埋まる分だけの在庫と、**除外の理由が1件ずつ出る在庫**も入れてある
 * （期限切れ＝サトウのごはん、冷蔵＝牛乳、開封済み＝飲みかけの水、換算できない＝
 * トイレットペーパー、期限が要確認＝ウェットティッシュ）。
 *
 * 期限は**流した日からの相対**で入れる。固定日にすると、日が経つほど「期限切れ」「期限間近」
 * 「余裕あり」の3状態が揃わなくなり、確認用としての意味が薄れるため。
 * **流すたびに、このfixtureが作った在庫と履歴（idが`fx-`で始まるもの）を作り直す。**
 * 画面で試した消費や取消が残っていると「毎回同じ状態」にならず、受入条件の読み合わせに使えないため。
 * 手で登録した在庫（idがcuid）には触らない。
 */
import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";

import { computeLotQuantity } from "../../src/lib/inventory/ledger.ts";
import { Decimal, type UnitCode } from "../../src/lib/inventory/units.ts";
import { ensureByName, ensurePositionByName } from "../seed-support.ts";

type TransactionType = "PURCHASE" | "CONSUME" | "DISPOSE" | "ADJUST";

// `prisma db seed`と違い、このスクリプトはPrisma CLIを経由しないので、
// `prisma.config.ts`が読んでいる`.env.local`をここでも読む（DATABASE_URLのため）。
loadEnv({ path: ".env.local", quiet: true });

const prisma = new PrismaClient();

// scripts/seed-dev.mjs が作る「開発用の家」と同じid。片方だけ変えないこと。
const HOUSEHOLD_ID = "dev-household-own";

/** 今日を基準にした日付。時刻を持たない`@db.Date`の列へ入れるのでUTCの0時に揃える。 */
function daysFromToday(days: number): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days),
  );
}

/** 履歴の発生時刻。過去に買ったものを、それらしい順序で並べるために使う。 */
function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 3_600_000);
}

const CATEGORIES = [
  { id: "fx-category-food", name: "食材", kind: "FOOD" as const, sortOrder: 11 },
  { id: "fx-category-drink", name: "飲料", kind: "DRINK" as const, sortOrder: 12 },
  { id: "fx-category-daily", name: "日用品", kind: "DAILY" as const, sortOrder: 13 },
  { id: "fx-category-emergency", name: "防災用品", kind: "EMERGENCY" as const, sortOrder: 14 },
];

const LOCATIONS = [
  {
    id: "fx-location-entrance",
    name: "玄関収納",
    kind: "CLOSET" as const,
    temperatureZone: "AMBIENT" as const,
    sortOrder: 21,
    positions: [{ id: "fx-position-entrance-upper", name: "上段", sortOrder: 1 }],
  },
  {
    // 「防災バッグ1個」は玄関収納に置いた本体（下のロット）で表し、
    // その中身をこの保管場所に入れる。バッグを開けたときの中身がそのまま一覧になる。
    id: "fx-location-emergency-bag",
    name: "防災バッグ",
    kind: "EMERGENCY_STOCK" as const,
    temperatureZone: "AMBIENT" as const,
    sortOrder: 22,
    positions: [],
  },
  {
    // 冷蔵の在庫が防災の日数に数えられないこと（#7）を確かめるための場所。
    id: "fx-location-fridge",
    name: "冷蔵庫",
    kind: "REFRIGERATOR" as const,
    temperatureZone: "CHILLED" as const,
    sortOrder: 24,
    positions: [],
  },
  {
    id: "fx-location-pantry",
    name: "食品棚",
    kind: "PANTRY" as const,
    temperatureZone: "AMBIENT" as const,
    sortOrder: 23,
    positions: [
      { id: "fx-position-pantry-upper", name: "上棚", sortOrder: 1 },
      { id: "fx-position-pantry-floor", name: "床置き", sortOrder: 2 },
    ],
  },
];

interface FixtureProduct {
  id: string;
  categoryId: string;
  name: string;
  defaultUnit: UnitCode;
  contentAmount?: string;
  contentUnit?: UnitCode;
  servingsPerUnit?: string;
  usesPerUnit?: string;
  /** 保管に必要な温度帯。既定は常温。冷蔵・冷凍は防災の日数に数えない（#7）。 */
  temperatureZone?: "AMBIENT" | "CHILLED" | "FROZEN";
  requiresHeating?: boolean;
  requiresWater?: boolean;
  emergencyRole?:
    | "NONE"
    | "STAPLE_FOOD"
    | "SIDE_DISH"
    | "DRINKING_WATER"
    | "UTILITY_WATER"
    | "HEAT_SOURCE"
    | "SANITATION"
    | "LIGHTING"
    | "POWER"
    | "MEDICAL"
    | "OTHER";
  note?: string;
}

const PRODUCTS: FixtureProduct[] = [
  {
    id: "fx-product-emergency-bag",
    categoryId: "fx-category-emergency",
    name: "防災バッグ",
    defaultUnit: "PIECE",
    emergencyRole: "OTHER",
    note: "中身は保管場所「防災バッグ」で管理する",
  },
  {
    id: "fx-product-toilet-paper",
    categoryId: "fx-category-daily",
    name: "トイレットペーパー",
    defaultUnit: "ROLL",
    emergencyRole: "SANITATION",
  },
  {
    id: "fx-product-portable-toilet",
    categoryId: "fx-category-emergency",
    name: "携帯トイレ",
    defaultUnit: "USE",
    usesPerUnit: "1",
    emergencyRole: "SANITATION",
  },
  {
    id: "fx-product-wet-tissue",
    categoryId: "fx-category-daily",
    name: "ウェットティッシュ",
    defaultUnit: "PIECE",
    emergencyRole: "SANITATION",
  },
  {
    id: "fx-product-duct-tape",
    categoryId: "fx-category-daily",
    name: "ガムテープ",
    defaultUnit: "PIECE",
    emergencyRole: "OTHER",
  },
  {
    // 「枚」の単位はまだ持っていないため個数（PIECE）で数える。
    // 単位を増やすかどうかは、ほかに枚で数えるものが出てきてから決める。
    id: "fx-product-garbage-bag",
    categoryId: "fx-category-daily",
    name: "ゴミ袋 45L",
    // 袋は「個」ではなく「袋」で数える。衛生の判定単位（回）へは換算できないため、
    // 防災の集計では「換算できない」として外れる（#8の点検画面でその例になっている）。
    defaultUnit: "BAG",
    emergencyRole: "SANITATION",
  },
  {
    id: "fx-product-flashlight",
    categoryId: "fx-category-emergency",
    name: "小型ライト",
    defaultUnit: "PIECE",
    emergencyRole: "LIGHTING",
  },
  {
    id: "fx-product-power-bank",
    categoryId: "fx-category-emergency",
    name: "モバイルバッテリー",
    defaultUnit: "PIECE",
    emergencyRole: "POWER",
  },
  {
    // 1本で1回ぶんの調理をまかなう想定。熱源があるとカップ麺が食料に数えられる（#7）。
    id: "fx-product-gas-canister",
    categoryId: "fx-category-emergency",
    name: "カセットボンベ",
    defaultUnit: "BOTTLE",
    usesPerUnit: "1",
    emergencyRole: "HEAT_SOURCE",
  },
  {
    // 冷蔵品。停電で使えなくなる前提なので、防災の日数には数えない（#7）。
    id: "fx-product-milk",
    categoryId: "fx-category-food",
    name: "牛乳 1L",
    defaultUnit: "BOTTLE",
    contentAmount: "1000",
    contentUnit: "MILLILITER",
    servingsPerUnit: "2",
    temperatureZone: "CHILLED",
    emergencyRole: "SIDE_DISH",
  },
  {
    id: "fx-product-water",
    categoryId: "fx-category-drink",
    name: "天然水 2L",
    defaultUnit: "BOTTLE",
    contentAmount: "2000",
    contentUnit: "MILLILITER",
    emergencyRole: "DRINKING_WATER",
  },
  {
    id: "fx-product-cup-noodle",
    categoryId: "fx-category-food",
    name: "カップ麺 しょうゆ",
    defaultUnit: "PIECE",
    servingsPerUnit: "1",
    requiresWater: true,
    requiresHeating: true,
    emergencyRole: "STAPLE_FOOD",
  },
  {
    id: "fx-product-packed-rice",
    categoryId: "fx-category-food",
    name: "サトウのごはん 200g",
    defaultUnit: "PACK",
    servingsPerUnit: "1",
    requiresHeating: true,
    emergencyRole: "STAPLE_FOOD",
  },
];

interface FixtureLot {
  id: string;
  productId: string;
  storageLocationId: string;
  storagePositionId?: string;
  unit: UnitCode;
  bestBeforeDays?: number;
  /** 「この在庫に期限は無い」と決めたもの。期限を入れ忘れた在庫（要確認）と分けるため（#5）。 */
  noExpiry?: boolean;
  openedHoursAgo?: number;
  note?: string;
  transactions: {
    id: string;
    type: TransactionType;
    quantityDelta: string;
    hoursAgo: number;
    note?: string;
  }[];
}

interface FixtureBarcode {
  id: string;
  code: string;
  symbology: "JAN" | "EAN8";
  productId: string;
  source: "SCAN" | "MANUAL";
  useCount: number;
  lastUsedHoursAgo: number;
  /** 読み取ったのに別商品として登録された回数。3以上で誤紐付けの疑いとして先頭に出る。 */
  mismatchCount?: number;
}

/**
 * バーコード（#9）。チェックディジットまで正しい値にしてある。
 *
 * 画面の手入力欄は不正なコードを弾くので、ここに合わない値を置くと
 * 「fixtureにはあるのに手で入れ直せない」コードができてしまう。
 */
const BARCODES: FixtureBarcode[] = [
  {
    id: "fx-barcode-water",
    code: "4901777018884",
    symbology: "JAN",
    productId: "fx-product-water",
    source: "SCAN",
    useCount: 4,
    lastUsedHoursAgo: 24 * 3,
  },
  {
    id: "fx-barcode-cup-noodle",
    code: "4907773010419",
    symbology: "JAN",
    productId: "fx-product-cup-noodle",
    source: "SCAN",
    useCount: 2,
    lastUsedHoursAgo: 24 * 12,
  },
  {
    // 誤紐付けの疑い。読み取ったあと毎回別の商品として登録された状態。
    id: "fx-barcode-packed-rice",
    code: "4940257101920",
    symbology: "JAN",
    productId: "fx-product-packed-rice",
    source: "SCAN",
    useCount: 1,
    lastUsedHoursAgo: 24 * 30,
    mismatchCount: 3,
  },
  {
    id: "fx-barcode-toilet-paper",
    code: "45690228",
    symbology: "EAN8",
    productId: "fx-product-toilet-paper",
    source: "MANUAL",
    useCount: 1,
    lastUsedHoursAgo: 24 * 40,
  },
];

interface FixtureRule {
  id: string;
  productId: string;
  storageLocationId: string;
  storagePositionId?: string;
  expiryKind: "NONE" | "BEST_BEFORE" | "USE_BY";
  shelfLifeDays?: number;
  confirmedCount: number;
}

/**
 * 学習ルール（#9）。「前回この商品をどう登録したか」を表す。
 *
 * 読み取り後の登録画面で、どの欄が「前回の確定」として埋まるかを確かめるためのもの。
 * 期限は日数で持つので、いつ流しても次回の既定日が今日からの相対になる。
 */
const PRODUCT_RULES: FixtureRule[] = [
  {
    id: "fx-rule-water",
    productId: "fx-product-water",
    storageLocationId: "fx-location-pantry",
    storagePositionId: "fx-position-pantry-floor",
    expiryKind: "BEST_BEFORE",
    shelfLifeDays: 730,
    confirmedCount: 4,
  },
  {
    id: "fx-rule-cup-noodle",
    productId: "fx-product-cup-noodle",
    storageLocationId: "fx-location-pantry",
    storagePositionId: "fx-position-pantry-upper",
    expiryKind: "BEST_BEFORE",
    shelfLifeDays: 180,
    confirmedCount: 2,
  },
  {
    id: "fx-rule-toilet-paper",
    productId: "fx-product-toilet-paper",
    storageLocationId: "fx-location-emergency-bag",
    expiryKind: "NONE",
    confirmedCount: 1,
  },
];

const LOTS: FixtureLot[] = [
  {
    id: "fx-lot-emergency-bag",
    productId: "fx-product-emergency-bag",
    storageLocationId: "fx-location-entrance",
    storagePositionId: "fx-position-entrance-upper",
    unit: "PIECE",
    noExpiry: true,
    note: "玄関収納の上段。中身は保管場所「防災バッグ」を見る",
    transactions: [
      { id: "fx-tx-emergency-bag-1", type: "PURCHASE", quantityDelta: "1", hoursAgo: 24 * 400 },
    ],
  },
  {
    // 使いかけのロールを0.4として持つ。小数の在庫が扱えることの確認を兼ねる。
    // 学習ルール（fx-rule-toilet-paper）で「期限なし」と確定済みの商品なので、
    // ロット側もnoExpiryにする。ここが空だと「期限を入れ忘れた在庫（要確認）」として
    // 数えられ、防災バッグの点検で開封済みの例が1件も出なくなる（#8）。
    id: "fx-lot-toilet-paper",
    productId: "fx-product-toilet-paper",
    storageLocationId: "fx-location-emergency-bag",
    unit: "ROLL",
    noExpiry: true,
    openedHoursAgo: 24 * 30,
    transactions: [
      { id: "fx-tx-toilet-paper-1", type: "PURCHASE", quantityDelta: "1", hoursAgo: 24 * 60 },
      {
        id: "fx-tx-toilet-paper-2",
        type: "CONSUME",
        quantityDelta: "-0.6",
        hoursAgo: 24 * 30,
        note: "外出先で使用",
      },
    ],
  },
  {
    id: "fx-lot-portable-toilet",
    productId: "fx-product-portable-toilet",
    storageLocationId: "fx-location-emergency-bag",
    unit: "USE",
    bestBeforeDays: 365 * 3,
    transactions: [
      { id: "fx-tx-portable-toilet-1", type: "PURCHASE", quantityDelta: "3", hoursAgo: 24 * 200 },
    ],
  },
  {
    id: "fx-lot-wet-tissue",
    productId: "fx-product-wet-tissue",
    storageLocationId: "fx-location-emergency-bag",
    unit: "PIECE",
    transactions: [
      { id: "fx-tx-wet-tissue-1", type: "PURCHASE", quantityDelta: "1", hoursAgo: 24 * 200 },
    ],
  },
  {
    id: "fx-lot-duct-tape",
    productId: "fx-product-duct-tape",
    storageLocationId: "fx-location-emergency-bag",
    unit: "PIECE",
    noExpiry: true,
    transactions: [
      { id: "fx-tx-duct-tape-1", type: "PURCHASE", quantityDelta: "1", hoursAgo: 24 * 200 },
    ],
  },
  {
    id: "fx-lot-garbage-bag",
    productId: "fx-product-garbage-bag",
    storageLocationId: "fx-location-emergency-bag",
    unit: "BAG",
    noExpiry: true,
    note: "3枚",
    transactions: [
      { id: "fx-tx-garbage-bag-1", type: "PURCHASE", quantityDelta: "3", hoursAgo: 24 * 200 },
    ],
  },
  {
    id: "fx-lot-flashlight",
    productId: "fx-product-flashlight",
    storageLocationId: "fx-location-emergency-bag",
    unit: "PIECE",
    noExpiry: true,
    transactions: [
      { id: "fx-tx-flashlight-1", type: "PURCHASE", quantityDelta: "1", hoursAgo: 24 * 400 },
    ],
  },
  {
    id: "fx-lot-power-bank",
    productId: "fx-product-power-bank",
    storageLocationId: "fx-location-emergency-bag",
    unit: "PIECE",
    noExpiry: true,
    transactions: [
      { id: "fx-tx-power-bank-1", type: "PURCHASE", quantityDelta: "1", hoursAgo: 24 * 300 },
    ],
  },
  {
    id: "fx-lot-gas-canister",
    productId: "fx-product-gas-canister",
    storageLocationId: "fx-location-pantry",
    storagePositionId: "fx-position-pantry-floor",
    unit: "BOTTLE",
    bestBeforeDays: 365 * 5,
    note: "3本 = 3回ぶん",
    transactions: [
      { id: "fx-tx-gas-canister-1", type: "PURCHASE", quantityDelta: "3", hoursAgo: 24 * 90 },
    ],
  },
  {
    // 期限内でも冷蔵なので、防災の日数には数えない（#7）。
    id: "fx-lot-milk",
    productId: "fx-product-milk",
    storageLocationId: "fx-location-fridge",
    unit: "BOTTLE",
    bestBeforeDays: 4,
    transactions: [
      { id: "fx-tx-milk-1", type: "PURCHASE", quantityDelta: "1", hoursAgo: 24 * 2 },
    ],
  },
  {
    // 未開封の10L（2L×5本）。開封したぶんは別ロットにして、期限の扱いを分ける。
    id: "fx-lot-water-sealed",
    productId: "fx-product-water",
    storageLocationId: "fx-location-pantry",
    storagePositionId: "fx-position-pantry-floor",
    unit: "BOTTLE",
    bestBeforeDays: 540,
    note: "未開封 2L×5本 = 10L",
    transactions: [
      { id: "fx-tx-water-sealed-1", type: "PURCHASE", quantityDelta: "6", hoursAgo: 24 * 40 },
      {
        id: "fx-tx-water-sealed-2",
        type: "CONSUME",
        quantityDelta: "-1",
        hoursAgo: 24 * 2,
        note: "1本を開けて飲みかけへ",
      },
    ],
  },
  {
    id: "fx-lot-water-opened",
    productId: "fx-product-water",
    storageLocationId: "fx-location-pantry",
    storagePositionId: "fx-position-pantry-floor",
    unit: "BOTTLE",
    bestBeforeDays: 540,
    openedHoursAgo: 48,
    note: "飲みかけ 1本",
    transactions: [
      { id: "fx-tx-water-opened-1", type: "PURCHASE", quantityDelta: "1", hoursAgo: 24 * 2 },
    ],
  },
  {
    id: "fx-lot-cup-noodle",
    productId: "fx-product-cup-noodle",
    storageLocationId: "fx-location-pantry",
    storagePositionId: "fx-position-pantry-upper",
    unit: "PIECE",
    bestBeforeDays: 5,
    transactions: [
      { id: "fx-tx-cup-noodle-1", type: "PURCHASE", quantityDelta: "3", hoursAgo: 24 * 20 },
      { id: "fx-tx-cup-noodle-2", type: "CONSUME", quantityDelta: "-1", hoursAgo: 24 * 3 },
    ],
  },
  {
    // 期限切れ。在庫としては残るが、防災の備蓄量には算入しない（#7で判定する）。
    id: "fx-lot-packed-rice",
    productId: "fx-product-packed-rice",
    storageLocationId: "fx-location-pantry",
    storagePositionId: "fx-position-pantry-upper",
    unit: "PACK",
    bestBeforeDays: -18,
    transactions: [
      { id: "fx-tx-packed-rice-1", type: "PURCHASE", quantityDelta: "4", hoursAgo: 24 * 120 },
    ],
  },
];

/**
 * 前回の実行や画面での操作でできた行を片づける。
 *
 * 取消（REVERSAL）行は他の履歴を外部キーで参照しているため、先に消す。
 * まとめて消すと、同じDELETE文の中で参照先が先に消えて制約違反になりうる。
 */
/**
 * 補充基準（#6）。商品ごと・カテゴリごとの両方を入れて、補充の画面で
 * 「不足あり」「足りている」「換算できない在庫がある」を一度に見られるようにする。
 *
 * - トイレットペーパーは0.4ロールしかないので候補に出る（商品ごとの基準）
 * - 飲料はカテゴリ合計で判定する。水は2L×5本＋飲みかけで、Lへ換算して数える
 * - カップ麺は2個。期限切れのサトウのごはんは数えないので、こちらも候補に出る
 */
const REPLENISHMENT_RULES = [
  {
    id: "fx-rule-toilet-paper",
    productId: "fx-product-toilet-paper",
    categoryId: null,
    thresholdAmount: "2",
    targetAmount: "12",
    unit: "ROLL" as UnitCode,
  },
  {
    id: "fx-rule-drink",
    productId: null,
    categoryId: "fx-category-drink",
    thresholdAmount: "20",
    targetAmount: "36",
    unit: "LITER" as UnitCode,
  },
  {
    id: "fx-rule-cup-noodle",
    productId: "fx-product-cup-noodle",
    categoryId: null,
    thresholdAmount: "3",
    targetAmount: "6",
    unit: "PIECE" as UnitCode,
  },
];

async function resetFixtureRows(): Promise<void> {
  // バーコードと学習ルール（#9）は在庫に依存しないので、ロットの有無にかかわらず作り直す。
  await prisma.barcode.deleteMany({
    where: { householdId: HOUSEHOLD_ID, id: { startsWith: "fx-barcode-" } },
  });
  await prisma.productRule.deleteMany({
    where: { householdId: HOUSEHOLD_ID, id: { startsWith: "fx-rule-" } },
  });
  // 補充基準は「対象ごとに1件」なので、作り直す前に必ず消す（idが違う同じ対象の基準が
  // 残っていると、下のcreateが一意制約で落ちる）。
  await prisma.replenishmentRule.deleteMany({
    where: { householdId: HOUSEHOLD_ID, id: { startsWith: "fx-rule-" } },
  });

  const lots = await prisma.stockLot.findMany({
    where: { householdId: HOUSEHOLD_ID, id: { startsWith: "fx-lot-" } },
    select: { id: true },
  });
  const lotIds = lots.map((lot) => lot.id);
  if (lotIds.length === 0) return;

  await prisma.inventoryTransaction.deleteMany({
    where: { householdId: HOUSEHOLD_ID, stockLotId: { in: lotIds }, type: "REVERSAL" },
  });
  await prisma.inventoryTransaction.deleteMany({
    where: { householdId: HOUSEHOLD_ID, stockLotId: { in: lotIds } },
  });
  await prisma.stockLot.deleteMany({
    where: { householdId: HOUSEHOLD_ID, id: { in: lotIds } },
  });
}

async function main(): Promise<void> {
  await prisma.household.upsert({
    where: { id: HOUSEHOLD_ID },
    update: {},
    create: { id: HOUSEHOLD_ID, name: "開発用の家" },
  });

  // 記録者はこの家庭のメンバーに限る（複合外部キーが他家庭のメンバーを弾く）。
  const member = await prisma.householdMember.findFirst({
    where: { householdId: HOUSEHOLD_ID },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const memberId = member?.id ?? null;

  await resetFixtureRows();

  // 同じ名前のカテゴリ・保管場所がすでにある家庭でも流せるように、名前で先に探す。
  // （`pnpm db:seed`や画面の「よく使う保管場所を作る」で作られていることがある。
  //   名前は家庭内で一意なので、idを固定してcreateすると重複で落ちる。）
  const categoryIds = new Map<string, string>();
  for (const { id, ...rest } of CATEGORIES) {
    categoryIds.set(id, await ensureByName(prisma, HOUSEHOLD_ID, "category", id, rest.name, rest));
  }

  const locationIds = new Map<string, string>();
  const positionIds = new Map<string, string>();
  for (const { id, positions, ...rest } of LOCATIONS) {
    const locationId = await ensureByName(
      prisma,
      HOUSEHOLD_ID,
      "storageLocation",
      id,
      rest.name,
      rest,
    );
    locationIds.set(id, locationId);

    for (const { id: positionId, ...positionRest } of positions) {
      positionIds.set(
        positionId,
        await ensurePositionByName(
          prisma,
          HOUSEHOLD_ID,
          locationId,
          positionId,
          positionRest.name,
          positionRest,
        ),
      );
    }
  }

  const productIds = new Map<string, string>();
  for (const { id, categoryId, contentAmount, servingsPerUnit, usesPerUnit, ...rest } of PRODUCTS) {
    const fields = {
      ...rest,
      categoryId: categoryIds.get(categoryId) ?? null,
      contentAmount: contentAmount ? new Decimal(contentAmount) : null,
      servingsPerUnit: servingsPerUnit ? new Decimal(servingsPerUnit) : null,
      usesPerUnit: usesPerUnit ? new Decimal(usesPerUnit) : null,
    };
    productIds.set(id, await ensureByName(prisma, HOUSEHOLD_ID, "product", id, rest.name, fields));
  }

  for (const lot of LOTS) {
    // 数量は履歴から組み立てる。実装と同じ経路を通るので、集計値と履歴がずれたfixtureを作れない。
    const quantity = computeLotQuantity(
      lot.transactions.map((transaction) => ({
        id: transaction.id,
        type: transaction.type,
        quantityDelta: new Decimal(transaction.quantityDelta),
        unit: lot.unit,
        reversesTransactionId: null,
      })),
      lot.unit,
    ).amount;

    const productId = productIds.get(lot.productId) as string;
    const lotFields = {
      productId,
      storageLocationId: locationIds.get(lot.storageLocationId) as string,
      storagePositionId: lot.storagePositionId
        ? (positionIds.get(lot.storagePositionId) as string)
        : null,
      unit: lot.unit,
      quantity,
      bestBeforeDate:
        lot.bestBeforeDays === undefined ? null : daysFromToday(lot.bestBeforeDays),
      useByDate: null,
      noExpiry: lot.noExpiry ?? false,
      openedAt: lot.openedHoursAgo === undefined ? null : hoursAgo(lot.openedHoursAgo),
      note: lot.note ?? null,
      status: quantity.greaterThan(new Decimal(0)) ? ("ACTIVE" as const) : ("DEPLETED" as const),
    };

    await prisma.stockLot.upsert({
      where: { id: lot.id },
      update: lotFields,
      create: { id: lot.id, householdId: HOUSEHOLD_ID, ...lotFields },
    });

    for (const transaction of lot.transactions) {
      const fields = {
        stockLotId: lot.id,
        productId,
        memberId,
        type: transaction.type,
        quantityDelta: new Decimal(transaction.quantityDelta),
        unit: lot.unit,
        reversesTransactionId: null,
        occurredAt: hoursAgo(transaction.hoursAgo),
        note: transaction.note ?? null,
      };

      await prisma.inventoryTransaction.upsert({
        where: { id: transaction.id },
        update: fields,
        create: { id: transaction.id, householdId: HOUSEHOLD_ID, ...fields },
      });
    }
  }

  for (const barcode of BARCODES) {
    await prisma.barcode.create({
      data: {
        id: barcode.id,
        householdId: HOUSEHOLD_ID,
        productId: productIds.get(barcode.productId) as string,
        code: barcode.code,
        symbology: barcode.symbology,
        source: barcode.source,
        useCount: barcode.useCount,
        lastUsedAt: hoursAgo(barcode.lastUsedHoursAgo),
        mismatchCount: barcode.mismatchCount ?? 0,
      },
    });
  }

  for (const rule of PRODUCT_RULES) {
    await prisma.productRule.create({
      data: {
        id: rule.id,
        householdId: HOUSEHOLD_ID,
        productId: productIds.get(rule.productId) as string,
        storageLocationId: locationIds.get(rule.storageLocationId) as string,
        storagePositionId: rule.storagePositionId
          ? (positionIds.get(rule.storagePositionId) as string)
          : null,
        expiryKind: rule.expiryKind,
        shelfLifeDays: rule.shelfLifeDays ?? null,
        confirmedCount: rule.confirmedCount,
        confirmedAt: hoursAgo(24),
      },
    });
  }

  for (const rule of REPLENISHMENT_RULES) {
    const productId = rule.productId ? (productIds.get(rule.productId) as string) : null;
    const categoryId = rule.categoryId ? (categoryIds.get(rule.categoryId) as string) : null;

    // 画面から同じ対象の基準を作っていた場合は、そちらを消してから入れ直す。
    await prisma.replenishmentRule.deleteMany({
      where: {
        householdId: HOUSEHOLD_ID,
        ...(productId ? { productId } : { categoryId }),
      },
    });

    await prisma.replenishmentRule.create({
      data: {
        id: rule.id,
        householdId: HOUSEHOLD_ID,
        productId,
        categoryId,
        thresholdAmount: new Decimal(rule.thresholdAmount),
        targetAmount: new Decimal(rule.targetAmount),
        unit: rule.unit,
      },
    });
  }

  console.log(
    `fixture投入完了: 保管場所 ${LOCATIONS.length}件 / 商品 ${PRODUCTS.length}件 / ` +
      `在庫 ${LOTS.length}件 / バーコード ${BARCODES.length}件 / 学習ルール ${PRODUCT_RULES.length}件 / ` +
      `補充基準 ${REPLENISHMENT_RULES.length}件`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
