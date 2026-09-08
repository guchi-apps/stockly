/**
 * 在庫の読み取り。
 *
 * **画面から`db.stockLot.findMany()`等を直接呼ばず、必ずここを通す。** どの関数も先頭で
 * `scopeToHousehold()`を通し、そこで返った`householdId`だけをwhereに使う
 * （画面ごとに`where: { householdId }`を手で書くと、1か所の書き忘れがそのまま越境になる）。
 *
 * 家庭1つぶんの在庫はせいぜい数百件なので、並べ替えは取得後にまとめて行う。
 * 「期限が無いものを最後に置く」がSQLでは書きにくく、DBごとのNULLの扱いに引きずられるため。
 */
import {
  buildStockLotCandidate,
  type StockLotCandidate,
} from "@/lib/barcode/candidate";
import type { BarcodeSymbology } from "@/lib/barcode/code";
import { db } from "@/lib/db";
import { scopeToHousehold } from "@/lib/household/access";
import { householdMembershipStore } from "@/lib/household/store";

import { resolveExpiry, type ExpiryState } from "./operations.ts";
import type { InventoryContext } from "./service.ts";

async function scope(ctx: InventoryContext): Promise<string> {
  const { householdId } = await scopeToHousehold(
    householdMembershipStore,
    ctx.userId,
    ctx.householdId,
  );
  return householdId;
}

const LOT_SELECT = {
  id: true,
  quantity: true,
  unit: true,
  status: true,
  bestBeforeDate: true,
  useByDate: true,
  openedAt: true,
  note: true,
  updatedAt: true,
  product: { select: { id: true, name: true, brand: true, category: { select: { name: true } } } },
  storageLocation: { select: { id: true, name: true } },
  storagePosition: { select: { id: true, name: true } },
} as const;

export type StockLotRow = Awaited<ReturnType<typeof listStockLots>>[number];

export interface InventoryFilter {
  /** 保管場所での絞り込み。`"none"`は場所が未設定のもの。 */
  readonly storageLocationId?: string | null;
  /** 商品名・ブランド・メモの部分一致。 */
  readonly q?: string | null;
  /** 期限切れだけを見る。 */
  readonly expiredOnly?: boolean;
  /** 使い切った・廃棄した在庫も含める。 */
  readonly includeInactive?: boolean;
}

/** 在庫一覧。期限が近い順に並べ、期限の無いものを後ろへ置く。 */
export async function listStockLots(ctx: InventoryContext, filter: InventoryFilter = {}) {
  const householdId = await scope(ctx);
  const q = (filter.q ?? "").trim();

  const lots = await db.stockLot.findMany({
    where: {
      householdId,
      ...(filter.includeInactive ? {} : { status: "ACTIVE" }),
      ...(filter.storageLocationId === "none"
        ? { storageLocationId: null }
        : filter.storageLocationId
          ? { storageLocationId: filter.storageLocationId }
          : {}),
      ...(q
        ? {
            OR: [
              { product: { name: { contains: q } } },
              { product: { brand: { contains: q } } },
              // 商品名を変えたあとも、バーコードで登録したときの名前で見つかるようにする（#9）。
              { product: { aliases: { some: { alias: { contains: q } } } } },
              { note: { contains: q } },
            ],
          }
        : {}),
    },
    select: LOT_SELECT,
  });

  const today = new Date();
  const rows = lots.map((lot) => ({ ...lot, expiry: resolveExpiry(lot, today) }));
  const filtered = filter.expiredOnly ? rows.filter((row) => row.expiry.status === "EXPIRED") : rows;

  return filtered.sort(compareByExpiryThenName);
}

function compareByExpiryThenName(
  a: { expiry: ExpiryState; product: { name: string } },
  b: { expiry: ExpiryState; product: { name: string } },
): number {
  const left = a.expiry.date?.getTime() ?? Number.POSITIVE_INFINITY;
  const right = b.expiry.date?.getTime() ?? Number.POSITIVE_INFINITY;
  if (left !== right) return left - right;
  return a.product.name.localeCompare(b.product.name, "ja");
}

/** 一覧を保管場所ごとにまとめる。場所が未設定のものは最後に「場所未設定」として置く。 */
export function groupByStorageLocation(rows: readonly StockLotRow[]) {
  const groups = new Map<string, { id: string | null; name: string; rows: StockLotRow[] }>();

  for (const row of rows) {
    const id = row.storageLocation?.id ?? null;
    const key = id ?? "__none__";
    const group = groups.get(key) ?? {
      id,
      name: row.storageLocation?.name ?? "場所未設定",
      rows: [],
    };
    group.rows.push(row);
    groups.set(key, group);
  }

  return [...groups.values()].sort((a, b) => {
    if (a.id === null) return 1;
    if (b.id === null) return -1;
    return a.name.localeCompare(b.name, "ja");
  });
}

export type StockLotDetail = NonNullable<Awaited<ReturnType<typeof getStockLotDetail>>>;

/** 在庫1件と、その入出庫履歴（新しい順）。 */
export async function getStockLotDetail(ctx: InventoryContext, lotId: string) {
  const householdId = await scope(ctx);

  const lot = await db.stockLot.findFirst({
    where: { id: lotId, householdId },
    select: {
      ...LOT_SELECT,
      product: {
        select: {
          id: true,
          name: true,
          brand: true,
          contentAmount: true,
          contentUnit: true,
          category: { select: { id: true, name: true } },
        },
      },
      transactions: {
        select: {
          id: true,
          type: true,
          quantityDelta: true,
          unit: true,
          reversesTransactionId: true,
          occurredAt: true,
          recordedAt: true,
          note: true,
          member: { select: { user: { select: { name: true, email: true } } } },
        },
        orderBy: [{ occurredAt: "desc" }, { recordedAt: "desc" }],
      },
    },
  });
  if (!lot) return null;

  return { ...lot, expiry: resolveExpiry(lot, new Date()) };
}

/** 保管場所と詳細位置。件数は画面の空状態と削除の可否の説明に使う。 */
export async function listStorageLocations(ctx: InventoryContext) {
  const householdId = await scope(ctx);

  const locations = await db.storageLocation.findMany({
    where: { householdId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      kind: true,
      temperatureZone: true,
      positions: {
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true, _count: { select: { stockLots: true } } },
      },
      _count: { select: { stockLots: true } },
    },
  });

  return locations;
}

/** 在庫の登録フォームで使う選択肢。 */
export async function listInventoryFormOptions(ctx: InventoryContext) {
  const householdId = await scope(ctx);

  const [locations, categories] = await Promise.all([
    db.storageLocation.findMany({
      where: { householdId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        positions: {
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          select: { id: true, name: true },
        },
      },
    }),
    db.category.findMany({
      where: { householdId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
  ]);

  return { locations, categories };
}

export type TransactionRow = Awaited<ReturnType<typeof listTransactions>>[number];

/** 家庭全体の入出庫履歴（新しい順）。 */
export async function listTransactions(ctx: InventoryContext, options: { limit?: number } = {}) {
  const householdId = await scope(ctx);

  return db.inventoryTransaction.findMany({
    where: { householdId },
    orderBy: [{ occurredAt: "desc" }, { recordedAt: "desc" }],
    take: options.limit ?? 100,
    select: {
      id: true,
      type: true,
      quantityDelta: true,
      unit: true,
      reversesTransactionId: true,
      occurredAt: true,
      note: true,
      stockLot: {
        select: {
          id: true,
          product: { select: { name: true } },
          storageLocation: { select: { name: true } },
        },
      },
      member: { select: { user: { select: { name: true, email: true } } } },
    },
  });
}

/**
 * 取り消された履歴のidの集合。
 *
 * 一覧では取消行そのものも並ぶため、「どの行がすでに取り消されたか」を1回のクエリで引いて、
 * 行ごとに問い合わせないようにする。
 */
export async function listReversedTransactionIds(ctx: InventoryContext): Promise<Set<string>> {
  const householdId = await scope(ctx);

  const reversals = await db.inventoryTransaction.findMany({
    where: { householdId, type: "REVERSAL", NOT: { reversesTransactionId: null } },
    select: { reversesTransactionId: true },
  });

  return new Set(
    reversals
      .map((row) => row.reversesTransactionId)
      .filter((id): id is string => typeof id === "string"),
  );
}

/** 在庫の件数。空状態の判定に使う。 */
export async function countStockLots(ctx: InventoryContext): Promise<number> {
  const householdId = await scope(ctx);
  return db.stockLot.count({ where: { householdId, status: "ACTIVE" } });
}

// ---------------------------------------------------------------------------
// バーコード（#9）
// ---------------------------------------------------------------------------

/**
 * 読み取ったコードが誤って別の商品に紐付いていると疑うまでの回数。
 *
 * 1回で知らせると、たまたま近い商品を登録しただけで警告が出る。3回続けて別の商品として
 * 登録されているなら、紐付けのほうが間違っている見込みが高い。
 */
export const BARCODE_MISMATCH_THRESHOLD = 3;

export interface BarcodeLookup {
  readonly code: string;
  readonly symbology: BarcodeSymbology;
  /** 紐付いている商品。未登録のコードなら`null`。 */
  readonly product: {
    readonly id: string;
    readonly name: string;
    readonly brand: string;
  } | null;
  /** 前回の内容を埋めた候補と、欄ごとの出所。 */
  readonly candidate: StockLotCandidate;
}

/**
 * コードから登録の候補を引く。
 *
 * 未登録のコードでも例外にせず、`product: null`と空の候補を返す。
 * 「知らないコードだった」ことは登録画面で案内すべき正常な結果で、失敗ではない。
 */
export async function lookupBarcode(
  ctx: InventoryContext,
  code: string,
  today: Date = new Date(),
): Promise<BarcodeLookup> {
  const householdId = await scope(ctx);

  const barcode = await db.barcode.findFirst({
    where: { householdId, code },
    select: {
      code: true,
      symbology: true,
      product: {
        select: {
          id: true,
          name: true,
          brand: true,
          defaultUnit: true,
          category: { select: { name: true } },
          rule: {
            select: {
              unit: true,
              storageLocationId: true,
              storagePositionId: true,
              expiryKind: true,
              shelfLifeDays: true,
              confirmedCount: true,
              category: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  if (!barcode) {
    return {
      code,
      symbology: "OTHER",
      product: null,
      candidate: buildStockLotCandidate({ today }),
    };
  }

  const { product } = barcode;
  const rule = product.rule;

  return {
    code: barcode.code,
    symbology: barcode.symbology,
    product: { id: product.id, name: product.name, brand: product.brand },
    candidate: buildStockLotCandidate({
      rule: rule
        ? {
            categoryName: rule.category?.name ?? null,
            unit: rule.unit,
            storageLocationId: rule.storageLocationId,
            storagePositionId: rule.storagePositionId,
            expiryKind: rule.expiryKind,
            shelfLifeDays: rule.shelfLifeDays,
            confirmedCount: rule.confirmedCount,
          }
        : null,
      master: {
        productName: product.name,
        categoryName: product.category?.name ?? null,
        defaultUnit: product.defaultUnit,
      },
      today,
    }),
  };
}

export type BarcodeRow = Awaited<ReturnType<typeof listBarcodes>>[number];

/**
 * 登録済みのコード一覧。誤紐付けの疑いがあるものを先頭へ置く。
 *
 * 並べ替えを取得後に行うのは、`mismatchCount`のしきい値との比較がSQLでは書きにくく、
 * 家庭1つぶんのコードはせいぜい数百件だから（在庫一覧と同じ方針）。
 */
export async function listBarcodes(ctx: InventoryContext) {
  const householdId = await scope(ctx);

  const barcodes = await db.barcode.findMany({
    where: { householdId },
    select: {
      id: true,
      code: true,
      symbology: true,
      source: true,
      sourceName: true,
      fetchedAt: true,
      useCount: true,
      lastUsedAt: true,
      mismatchCount: true,
      product: { select: { id: true, name: true, brand: true } },
    },
  });

  return barcodes
    .map((barcode) => ({
      ...barcode,
      suspect: barcode.mismatchCount >= BARCODE_MISMATCH_THRESHOLD,
    }))
    .sort((a, b) => {
      if (a.suspect !== b.suspect) return a.suspect ? -1 : 1;
      const left = a.lastUsedAt?.getTime() ?? 0;
      const right = b.lastUsedAt?.getTime() ?? 0;
      if (left !== right) return right - left;
      return a.code.localeCompare(b.code);
    });
}

/** 付け替え先として選べる商品。 */
export async function listProductOptions(ctx: InventoryContext) {
  const householdId = await scope(ctx);

  const products = await db.product.findMany({
    where: { householdId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, brand: true },
  });

  return products;
}
