"use server";

/**
 * 写真から減らす画面のServer Action（#11）。
 *
 * **解析と確定を別のアクションに分けてある。** `analyzeConsumptionPhotosAction()`は候補を作るだけで
 * 在庫を触らず、在庫が動くのは`confirmConsumptionCandidateAction()`だけ。押されない限り何も減らない、
 * という受入条件（「AIが自動確定する経路を持たない」）を、呼び出しの形からも保つ。
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { backPath, str, userFacingMessage, withParams } from "@/app/(app)/action-result";
import {
  analyzeConsumptionPhotos,
  confirmConsumptionCandidate,
  parseScanKind,
  rejectConsumptionCandidate,
} from "@/lib/consumption/service";
import { requireInventoryContextForAction } from "@/lib/inventory/context";
import { parseAmount, parseOperationId } from "@/lib/inventory/operations";

const PAGE = "/inventory/consume";

function revalidateConsumption(): void {
  revalidatePath(PAGE);
  revalidatePath("/inventory");
  revalidatePath("/expiry");
  revalidatePath("/history");
}

/** フォームから画像だけを取り出す。空のファイル欄（何も選ばずに送信）は数えない。 */
async function readImages(formData: FormData): Promise<Uint8Array[]> {
  const files = formData.getAll("images").filter((value): value is File => value instanceof File);
  const withContent = files.filter((file) => file.size > 0);
  return Promise.all(
    withContent.map(async (file) => new Uint8Array(await file.arrayBuffer())),
  );
}

/**
 * 写真を送って候補を作る。**在庫は変わらない。**
 *
 * 結果は戻り先の`?notice=`／`?error=`で伝える（押すだけの操作と同じ扱い）。候補そのものは
 * `?scan=<id>`で開き直せるので、画面を閉じても確定していない候補は残る。
 */
export async function analyzeConsumptionPhotosAction(formData: FormData): Promise<void> {
  const ctx = await requireInventoryContextForAction();
  let outcome: { notice?: string; error?: string };
  let target = PAGE;

  try {
    const kind = parseScanKind(str(formData, "kind"));
    const result = await analyzeConsumptionPhotos(ctx, {
      kind,
      images: await readImages(formData),
    });

    target = `${PAGE}?scan=${result.scanId}`;
    outcome = result.failed
      ? { error: result.error ?? "写真を読み取れませんでした。" }
      : result.reused
      ? { notice: "同じ写真はすでに読み取り済みです。前回の候補を出しています。" }
      : result.candidateCount === 0
        ? {
            notice:
              result.skippedCount > 0
                ? "減らせる候補は見つかりませんでした。理由を確かめてください。"
                : "写真から在庫に結び付くものを読み取れませんでした。",
          }
        : { notice: `減らす候補を${result.candidateCount}件つくりました。内容を確かめてください。` };
  } catch (error) {
    outcome = { error: userFacingMessage(error) };
  }

  revalidateConsumption();
  redirect(withParams(target, outcome));
}

/** 候補を1件確定し、消費として記録する。数量は画面で直せる。 */
export async function confirmConsumptionCandidateAction(formData: FormData): Promise<void> {
  const back = backPath(formData, PAGE);
  const ctx = await requireInventoryContextForAction();
  let outcome: { notice?: string; error?: string };

  try {
    const raw = str(formData, "amount");
    const result = await confirmConsumptionCandidate(ctx, {
      itemId: str(formData, "itemId"),
      operationId: parseOperationId(str(formData, "operationId")),
      amount: raw === "" ? null : parseAmount(raw, "amount", "減らす量"),
    });

    outcome =
      result.status === "recorded"
        ? { notice: "消費として記録しました。間違いなら履歴から取り消せます。" }
        : { notice: "この候補は記録済みです（数量は二重に動いていません）。" };
  } catch (error) {
    outcome = { error: userFacingMessage(error) };
  }

  revalidateConsumption();
  redirect(withParams(back, outcome));
}

/** 候補を却下する。在庫は動かない。 */
export async function rejectConsumptionCandidateAction(formData: FormData): Promise<void> {
  const back = backPath(formData, PAGE);
  const ctx = await requireInventoryContextForAction();
  let outcome: { notice?: string; error?: string };

  try {
    await rejectConsumptionCandidate(ctx, { itemId: str(formData, "itemId") });
    outcome = { notice: "この候補は却下しました。在庫は変わっていません。" };
  } catch (error) {
    outcome = { error: userFacingMessage(error) };
  }

  revalidateConsumption();
  redirect(withParams(back, outcome));
}
