/**
 * 補充の書き込みと、Notion買い物リストへの送信。
 *
 * 守っていることは4つ。
 *
 * 1. **家庭の境界。** どの関数も最初に`scopeToHousehold()`を通し、そこで返った`householdId`
 *    だけをwhere・dataに使う。
 * 2. **在庫は変えない。** ここが触るのは`ReplenishmentRule`と`ShoppingListEntry`だけで、
 *    `StockLot`・`InventoryTransaction`には一切書かない。買い物リストへ送ることは
 *    「買った」ことではないため（在庫が動くのは在庫画面で補充を記録したとき）。
 * 3. **Notionへの通信をDBのトランザクションの中で行わない。** 送信に失敗しても、
 *    直前までの書き込み（候補の確定・他の候補の送信結果）は残す。**失敗した候補は
 *    理由付きでFAILEDのまま残り、そのまま送り直せる**（#6の受入条件）。
 * 4. **同じ候補を二重にNotionへ送らない。** 対象（商品・カテゴリ）ごとに`ShoppingListEntry`は
 *    1件だけで、送信済みならNotionの同じページを更新する。送信中は`SENDING`で印を付け、
 *    同時に走った2回目を弾く。
 */
import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { scopeToHousehold } from "@/lib/household/access";
import { householdMembershipStore } from "@/lib/household/store";
import { InventoryInputError } from "@/lib/inventory/operations";
import {
  InventoryConflictError,
  InventoryNotFoundError,
  type InventoryContext,
} from "@/lib/inventory/service";
import { Decimal, type UnitCode } from "@/lib/inventory/units";
import { readNotionConfig } from "@/lib/notion/config";
import { NotionRequestError, SEND_INTERVAL_MS, upsertShoppingListItem } from "@/lib/notion/client";

import { listShortages } from "./queries.ts";
import type { ReplenishmentRuleFormValue, ReplenishmentRuleAmountsValue } from "./rules.ts";
import { formatAmountWithUnit, type ShortageResult } from "./shortage.ts";

/**
 * `SENDING`のまま取り残された行を、もう一度送れるようにするまでの時間。
 *
 * 送信の途中でプロセスが落ちると`SENDING`が残る。ここを設けないと、その候補は
 * 二度と送れなくなる（人が直せない状態を作らない）。
 */
const SENDING_STALE_MS = 2 * 60_000;

async function scope(ctx: InventoryContext): Promise<string> {
  const { householdId } = await scopeToHousehold(
    householdMembershipStore,
    ctx.userId,
    ctx.householdId,
  );
  return householdId;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

// ---------------------------------------------------------------------------
// 補充基準
// ---------------------------------------------------------------------------

export async function createReplenishmentRule(
  ctx: InventoryContext,
  params: ReplenishmentRuleFormValue,
): Promise<{ id: string }> {
  const householdId = await scope(ctx);

  // 対象が同じ家庭のものかを、書き込む前に確かめる（複合外部キーでも弾けるが、
  // その場合に出るのは制約違反のエラーで、何が悪いのか画面に伝わらない）。
  if (params.targetKind === "PRODUCT") {
    const product = await db.product.findFirst({
      where: { id: params.targetId, householdId },
      select: { id: true },
    });
    if (!product) throw new InventoryInputError("target", "この商品は選べません。");
  } else {
    const category = await db.category.findFirst({
      where: { id: params.targetId, householdId },
      select: { id: true },
    });
    if (!category) throw new InventoryInputError("target", "このカテゴリは選べません。");
  }

  try {
    return await db.replenishmentRule.create({
      data: {
        householdId,
        productId: params.targetKind === "PRODUCT" ? params.targetId : null,
        categoryId: params.targetKind === "CATEGORY" ? params.targetId : null,
        thresholdAmount: params.thresholdAmount,
        targetAmount: params.targetAmount,
        unit: params.unit,
        enabled: params.enabled,
      },
      select: { id: true },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new InventoryInputError(
        "target",
        "この対象にはすでに補充基準があります。既存の基準を編集してください。",
      );
    }
    throw error;
  }
}

export async function updateReplenishmentRuleAmounts(
  ctx: InventoryContext,
  params: ReplenishmentRuleAmountsValue & { ruleId: string },
): Promise<void> {
  const householdId = await scope(ctx);

  const updated = await db.replenishmentRule.updateMany({
    where: { id: params.ruleId, householdId },
    data: { thresholdAmount: params.thresholdAmount, targetAmount: params.targetAmount },
  });
  if (updated.count === 0) throw new InventoryNotFoundError("この補充基準は見つかりませんでした。");
}

export async function setReplenishmentRuleEnabled(
  ctx: InventoryContext,
  params: { ruleId: string; enabled: boolean },
): Promise<void> {
  const householdId = await scope(ctx);

  const updated = await db.replenishmentRule.updateMany({
    where: { id: params.ruleId, householdId },
    data: { enabled: params.enabled },
  });
  if (updated.count === 0) throw new InventoryNotFoundError("この補充基準は見つかりませんでした。");
}

export async function deleteReplenishmentRule(
  ctx: InventoryContext,
  params: { ruleId: string },
): Promise<void> {
  const householdId = await scope(ctx);

  const deleted = await db.replenishmentRule.deleteMany({
    where: { id: params.ruleId, householdId },
  });
  if (deleted.count === 0) throw new InventoryNotFoundError("この補充基準は見つかりませんでした。");
}

// ---------------------------------------------------------------------------
// Notionへの送信
// ---------------------------------------------------------------------------

export interface SendSummary {
  readonly sent: number;
  readonly failed: number;
  /** 送信中だった・すでに不足が解消していたなどで送らなかった件数。 */
  readonly skipped: number;
  /** 最初の失敗の理由。画面にはこれだけを出し、詳細は各行に残す。 */
  readonly firstError: string | null;
}

/** Notionの接続先が設定されているか。画面が送信ボタンを出すかどうかの判断に使う。 */
export function isNotionConfigured(): boolean {
  return readNotionConfig() !== null;
}

/**
 * 選ばれた候補をNotionの買い物リストへ送る。
 *
 * 送る数量は**画面から来た値を使わず、サーバー側で計算し直す**（古い画面から送られた
 * 不足量をそのまま信じない）。不足が解消していた候補は送らずに数える。
 */
export async function sendCandidatesToNotion(
  ctx: InventoryContext,
  params: { ruleIds: readonly string[] },
): Promise<SendSummary> {
  const householdId = await scope(ctx);
  const config = readNotionConfig();
  if (!config) {
    throw new InventoryConflictError(
      "Notionの接続先が設定されていないため送れません。設定を追加してから、もう一度お試しください。",
    );
  }

  const selected = new Set(params.ruleIds);
  const shortages = (await listShortages(ctx)).filter(
    (result) => selected.has(result.ruleId) && result.isShort,
  );

  let sent = 0;
  let failed = 0;
  let skipped = params.ruleIds.length - shortages.length;
  let firstError: string | null = null;

  for (const [index, shortage] of shortages.entries()) {
    const entry = await claimEntryForShortage(householdId, shortage);
    if (!entry) {
      skipped += 1;
      continue;
    }

    // Notionのレート制限（平均3リクエスト/秒）に触れないよう、1件ずつ間隔を空けて送る。
    if (index > 0) await sleep(SEND_INTERVAL_MS);

    const error = await sendEntry(householdId, entry);
    if (error) {
      failed += 1;
      firstError ??= error;
    } else {
      sent += 1;
    }
  }

  return { sent, failed, skipped, firstError };
}

/** 送信に失敗した・もう一度送りたい記録を、同じNotionページへ送り直す。 */
export async function resendShoppingListEntry(
  ctx: InventoryContext,
  params: { entryId: string },
): Promise<{ error: string | null }> {
  const householdId = await scope(ctx);
  if (!readNotionConfig()) {
    throw new InventoryConflictError("Notionの接続先が設定されていないため送れません。");
  }

  const claimed = await claimEntryById(householdId, params.entryId);
  if (!claimed) {
    throw new InventoryConflictError(
      "この候補はいま送信中です。しばらく待ってから画面を開き直してください。",
    );
  }

  return { error: await sendEntry(householdId, claimed) };
}

/**
 * 送信記録を取り下げる。
 *
 * **Notion側の項目は消さない。** 買い物リストの正本はNotionで、そこで何を残すかは
 * 利用者が決めることだから。この行を消すと、次に不足したときは新しい項目として送られる。
 */
export async function deleteShoppingListEntry(
  ctx: InventoryContext,
  params: { entryId: string },
): Promise<void> {
  const householdId = await scope(ctx);

  const deleted = await db.shoppingListEntry.deleteMany({
    where: { id: params.entryId, householdId },
  });
  if (deleted.count === 0) throw new InventoryNotFoundError("この送信記録は見つかりませんでした。");
}

// ---------------------------------------------------------------------------
// 送信の実体
// ---------------------------------------------------------------------------

interface ClaimedEntry {
  readonly id: string;
  readonly name: string;
  readonly shortageAmount: Decimal;
  readonly unit: UnitCode;
  readonly notionPageId: string | null;
}

async function findEntryByTarget(householdId: string, shortage: ShortageResult) {
  return db.shoppingListEntry.findFirst({
    where: {
      householdId,
      ...(shortage.target.kind === "PRODUCT"
        ? { productId: shortage.target.id }
        : { categoryId: shortage.target.id }),
    },
    select: { id: true, unit: true },
  });
}

/**
 * 候補を送信対象として確保する。
 *
 * 対象ごとに記録は1件だけ作り、すでにあればそこへ最新の不足量を書き戻す。
 * `SENDING`のまま残っている行は、取り残し（`SENDING_STALE_MS`）でなければ確保しない
 * ——同じ候補が同時に2回Notionへ飛ぶのを、ここで止める。
 */
async function claimEntryForShortage(
  householdId: string,
  shortage: ShortageResult,
): Promise<ClaimedEntry | null> {
  const existing = await findEntryByTarget(householdId, shortage);

  if (!existing) {
    try {
      const created = await db.shoppingListEntry.create({
        data: {
          householdId,
          productId: shortage.target.kind === "PRODUCT" ? shortage.target.id : null,
          categoryId: shortage.target.kind === "CATEGORY" ? shortage.target.id : null,
          name: shortage.target.name,
          shortageAmount: shortage.shortageAmount,
          unit: shortage.unit,
          status: "SENDING",
          sendingStartedAt: new Date(),
        },
        select: { id: true, name: true, shortageAmount: true, unit: true, notionPageId: true },
      });
      return toClaimed(created);
    } catch (error) {
      // 同じ対象の記録が同時に作られた場合は、下の「既存を確保する」経路へ落とす。
      if (!isUniqueViolation(error)) throw error;
    }
  }

  const target = existing ?? (await findEntryByTarget(householdId, shortage));
  if (!target) return null;

  return claimExisting(householdId, target.id, {
    name: shortage.target.name,
    shortageAmount: shortage.shortageAmount,
    unit: shortage.unit,
  });
}

async function claimEntryById(householdId: string, entryId: string): Promise<ClaimedEntry | null> {
  const existing = await db.shoppingListEntry.findFirst({
    where: { id: entryId, householdId },
    select: { id: true },
  });
  if (!existing) throw new InventoryNotFoundError("この送信記録は見つかりませんでした。");

  return claimExisting(householdId, existing.id, null);
}

/**
 * 既存の記録を`SENDING`にして確保する。
 *
 * 条件付きの`updateMany`（＝1文のUPDATE）にしてあるので、同時に2つ走っても
 * 行を更新できるのは片方だけになる。0件だった側は「送信中」として送らない。
 */
async function claimExisting(
  householdId: string,
  entryId: string,
  content: { name: string; shortageAmount: Decimal; unit: UnitCode } | null,
): Promise<ClaimedEntry | null> {
  const staleBefore = new Date(Date.now() - SENDING_STALE_MS);

  const claimed = await db.shoppingListEntry.updateMany({
    where: {
      id: entryId,
      householdId,
      OR: [
        { status: { not: "SENDING" } },
        { sendingStartedAt: null },
        { sendingStartedAt: { lt: staleBefore } },
      ],
    },
    data: {
      ...(content
        ? { name: content.name, shortageAmount: content.shortageAmount, unit: content.unit }
        : {}),
      status: "SENDING",
      sendingStartedAt: new Date(),
    },
  });
  if (claimed.count === 0) return null;

  const row = await db.shoppingListEntry.findFirst({
    where: { id: entryId, householdId },
    select: { id: true, name: true, shortageAmount: true, unit: true, notionPageId: true },
  });
  return row ? toClaimed(row) : null;
}

function toClaimed(row: {
  id: string;
  name: string;
  shortageAmount: Prisma.Decimal;
  unit: UnitCode;
  notionPageId: string | null;
}): ClaimedEntry {
  return {
    id: row.id,
    name: row.name,
    shortageAmount: new Decimal(row.shortageAmount),
    unit: row.unit,
    notionPageId: row.notionPageId,
  };
}

/**
 * 1件をNotionへ送り、結果を記録する。
 *
 * **例外を外へ出さない。** 1件の失敗で残りの送信まで止めると、成功したぶんの記録だけが
 * 残って画面と食い違う。失敗は戻り値（理由の文字列）で伝え、行にも残す。
 */
async function sendEntry(householdId: string, entry: ClaimedEntry): Promise<string | null> {
  const config = readNotionConfig();
  if (!config) return "Notionの接続先が設定されていません。";

  try {
    const page = await upsertShoppingListItem(
      config,
      {
        name: entry.name,
        quantityText: formatAmountWithUnit(entry.shortageAmount, entry.unit),
        sourceId: `stockly:${entry.id}`,
      },
      entry.notionPageId,
    );

    await db.shoppingListEntry.updateMany({
      where: { id: entry.id, householdId },
      data: {
        status: "SENT",
        notionPageId: page.pageId,
        notionUrl: page.url,
        lastError: null,
        lastSentAt: new Date(),
        sendingStartedAt: null,
      },
    });
    return null;
  } catch (error) {
    const message =
      error instanceof NotionRequestError
        ? error.message
        : "Notionへの送信に失敗しました。時間をおいて送り直してください。";

    await db.shoppingListEntry.updateMany({
      where: { id: entry.id, householdId },
      data: { status: "FAILED", lastError: message, sendingStartedAt: null },
    });
    return message;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
