/**
 * 入出庫履歴（正本）から`StockLot.quantity`（集計値）を組み立て直す。
 *
 * 障害・誤操作・バックアップからの復元のあとで、集計値が履歴とずれていないかを一覧し、
 * 必要なら履歴の合計へ戻すためのもの（#13）。日常の在庫操作は`service.ts`が同じトランザクション内で
 * 集計値を更新するため、この処理が要るのは異常時だけ。
 *
 * - **履歴は一切書き換えない。** 直すのは`StockLot.quantity`と、それに従う`status`だけ
 * - 判定は`ledger.ts`の`verifyLotQuantity()`に任せ、ここで独自の計算をしない
 * - 単位の換算ができない履歴が混ざったロットは直さず、`errors`として報告する（人が見る）
 *
 * `scripts/rebuild-lot-quantities.ts`（`pnpm db:rebuild-quantities`）と`db-tests/`から呼ぶため、
 * Prismaクライアントは引数で受け取る（`@/`のパスエイリアスは`node --test`が解決できない）。
 */
import type { Prisma, PrismaClient } from "@prisma/client";

import { verifyLotQuantity, type LedgerEntry, type LotConsistencyResult } from "./ledger.ts";
import { nextLotStatus } from "./operations.ts";
import { UnitConversionError } from "./units.ts";

/** Prismaのクライアント本体でも、`$transaction`の中のクライアントでも受け取れるようにする。 */
export type RebuildClient = PrismaClient | Prisma.TransactionClient;

export interface LotDrift {
  readonly lotId: string;
  readonly householdId: string;
  readonly productName: string;
  readonly result: LotConsistencyResult;
}

export interface LotRebuildError {
  readonly lotId: string;
  readonly householdId: string;
  readonly productName: string;
  readonly message: string;
}

export interface RebuildReport {
  /** 照合したロットの数。 */
  readonly checked: number;
  /** 集計値が履歴と一致していたロットの数。 */
  readonly consistent: number;
  /** ずれていたロット。`apply: true`なら、これらは履歴の合計へ直されている。 */
  readonly drifted: readonly LotDrift[];
  /** 単位が換算できない等で照合できなかったロット。手で見る必要がある。 */
  readonly errors: readonly LotRebuildError[];
  /** 実際にUPDATEしたか（falseならdry-run）。 */
  readonly applied: boolean;
}

export interface RebuildOptions {
  /** trueのとき、ずれたロットの`quantity`と`status`を履歴の合計へ更新する。既定はfalse（一覧だけ）。 */
  readonly apply?: boolean;
  /** 指定した家庭だけを対象にする。省略時は全家庭。 */
  readonly householdId?: string;
}

/**
 * 全ロット（または1家庭のロット）を履歴と照合し、必要なら集計値を直す。
 *
 * ロットごとに独立して扱い、1件の失敗で残りを止めない（復元作業の途中で全体が止まると、
 * どこまで直ったのかが分からなくなる）。
 */
export async function rebuildLotQuantities(
  client: RebuildClient,
  options: RebuildOptions = {},
): Promise<RebuildReport> {
  const lots = await client.stockLot.findMany({
    where: options.householdId ? { householdId: options.householdId } : undefined,
    select: {
      id: true,
      householdId: true,
      quantity: true,
      unit: true,
      status: true,
      product: { select: { name: true } },
      transactions: {
        select: {
          id: true,
          type: true,
          quantityDelta: true,
          unit: true,
          reversesTransactionId: true,
        },
      },
    },
    orderBy: [{ householdId: "asc" }, { id: "asc" }],
  });

  const drifted: LotDrift[] = [];
  const errors: LotRebuildError[] = [];
  let consistent = 0;

  for (const lot of lots) {
    let result: LotConsistencyResult;
    try {
      result = verifyLotQuantity(lot, lot.transactions as LedgerEntry[]);
    } catch (error) {
      errors.push({
        lotId: lot.id,
        householdId: lot.householdId,
        productName: lot.product.name,
        message:
          error instanceof UnitConversionError || error instanceof Error
            ? error.message
            : String(error),
      });
      continue;
    }

    if (result.consistent) {
      consistent += 1;
      continue;
    }

    drifted.push({
      lotId: lot.id,
      householdId: lot.householdId,
      productName: lot.product.name,
      result,
    });

    if (options.apply) {
      // 履歴の合計をそのまま集計値にする。statusは数量から決め直す
      // （負のロットはACTIVEのまま残す、0なら使い切り。取消で0を割った場合と同じ規則）。
      await client.stockLot.update({
        where: { id: lot.id },
        data: {
          quantity: result.computed.amount,
          status: nextLotStatus(result.computed, lot.status === "DISCARDED" ? "DISPOSE" : "ADJUST"),
        },
      });
    }
  }

  return {
    checked: lots.length,
    consistent,
    drifted,
    errors,
    applied: options.apply === true,
  };
}
