"use server";

/**
 * 写真取込（#10）のServer Action。
 *
 * ここは「フォームの値を読む → `src/lib/intake/service.ts`を呼ぶ → 画面へ戻す」だけを担う。
 * 入力の検証は`src/lib/intake/settings.ts`と`src/lib/inventory/operations.ts`が持ち、
 * 抽出の中身は`src/lib/intake/`が持つ。
 *
 * **ファイルは`rawInput()`では読めない**（`typeof value === "string"`で絞っているため）。
 * 画像だけは`formData.getAll()`から`File`として取り出す。
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { rawInput, str, userFacingMessage, withParams } from "@/app/(app)/action-result";
import type { InventoryFormState } from "@/app/(app)/form-state";
import { requireInventoryContextForAction } from "@/lib/inventory/context";
import { InventoryInputError, parseStockLotForm } from "@/lib/inventory/operations";
import { MAX_IMAGES_PER_BATCH } from "@/lib/intake/config";
import { detectImageType, stripMetadata } from "@/lib/intake/image";
import { INTAKE_IMAGE_KINDS, type IntakeImageKind } from "@/lib/intake/prompt";
import {
  applyIntakeCandidates,
  createIntakeBatch,
  deleteAllIntakeImages,
  discardIntakeBatch,
  setIntakeCandidateRejected,
  updateIntakeCandidate,
  type UploadedImage,
} from "@/lib/intake/service";
import { assertIntakeSettings, saveIntakeSettings } from "@/lib/intake/settings";

function revalidateIntake(batchId?: string): void {
  revalidatePath("/intake");
  if (batchId) revalidatePath(`/intake/${batchId}`);
}

/** 写真を取り込んで候補を作る。結果は戻り先の`?notice=`／`?error=`で伝える。 */
export async function createIntakeAction(formData: FormData): Promise<void> {
  const ctx = await requireInventoryContextForAction();

  let images: UploadedImage[];
  try {
    images = await readImages(formData);
  } catch (error) {
    redirect(withParams("/intake", { error: userFacingMessage(error) }));
  }

  let redirectTo: string;
  try {
    const result = await createIntakeBatch(ctx, { images });

    redirectTo =
      result.status === "duplicate"
        ? withParams(`/intake/${result.batchId}`, {
            notice: "この写真はすでに取り込み済みです。前回の候補を開きました。",
          })
        : result.status === "failed"
          ? withParams("/intake", { error: result.message })
          : withParams(`/intake/${result.batchId}`, { notice: "候補ができました。内容を確認してください。" });
  } catch (error) {
    redirect(withParams("/intake", { error: userFacingMessage(error) }));
  }

  revalidateIntake();
  redirect(redirectTo);
}

/**
 * アップロードされた画像を読む。
 *
 * **形式は申告された`Content-Type`ではなく、中身の先頭バイトで決める**
 * （`docs/testing-strategy.md`の「画像アップロード制約の基準」）。申告を信じると、
 * `image/jpeg`と名乗るだけで何でも保存・送信できてしまう。
 *
 * **EXIFなどの付帯情報はここで落とす。** ブラウザ側でcanvasへ描き直したものは消えているが、
 * JSが動かなかった場合は元の画像がそのまま届くため、サーバー側にも同じ関所を置く。
 *
 * 枚数はここで弾き、バイト数の上限は`service.ts`が持つ。
 */
async function readImages(formData: FormData): Promise<UploadedImage[]> {
  const files = formData.getAll("photos").filter((value): value is File => value instanceof File);
  const kinds = formData.getAll("kind").map(toImageKind);

  const usable = files.filter((file) => file.size > 0);
  if (usable.length === 0) {
    throw new InventoryInputError("images", "写真を1枚以上選んでください。");
  }
  if (usable.length > MAX_IMAGES_PER_BATCH) {
    throw new InventoryInputError(
      "images",
      `写真は1回に${MAX_IMAGES_PER_BATCH}枚までです。分けて取り込んでください。`,
    );
  }

  const images: UploadedImage[] = [];
  for (const [index, file] of usable.entries()) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = detectImageType(bytes);
    if (!type) {
      throw new InventoryInputError(
        "images",
        "JPEG・PNG・WebPの画像だけを取り込めます（HEICのまま送られた場合もここで止まります）。",
      );
    }
    images.push({
      kind: kinds[index] ?? "UNKNOWN",
      mimeType: type,
      bytes: stripMetadata(bytes, type),
    });
  }
  return images;
}

function toImageKind(value: FormDataEntryValue): IntakeImageKind {
  const found = INTAKE_IMAGE_KINDS.find((kind) => kind === value);
  return found ?? "UNKNOWN";
}

/** 候補を却下する・却下を取り消す。 */
export async function toggleIntakeCandidateAction(formData: FormData): Promise<void> {
  const ctx = await requireInventoryContextForAction();
  const candidateId = str(formData, "candidateId");
  const batchId = str(formData, "batchId");
  const rejected = str(formData, "rejected") === "true";

  try {
    await setIntakeCandidateRejected(ctx, { candidateId, rejected });
  } catch (error) {
    redirect(withParams(`/intake/${batchId}`, { error: userFacingMessage(error) }));
  }

  revalidateIntake(batchId);
  redirect(
    withParams(`/intake/${batchId}`, {
      notice: rejected ? "候補を却下しました。" : "却下を取り消しました。",
    }),
  );
}

/** 確認待ちの候補をまとめて在庫へ反映する。 */
export async function applyIntakeAction(formData: FormData): Promise<void> {
  const ctx = await requireInventoryContextForAction();
  const batchId = str(formData, "batchId");

  let message: string;
  try {
    const result = await applyIntakeCandidates(ctx, { batchId });
    const parts = [`${result.applied}件を在庫へ登録しました。`];
    if (result.duplicated > 0) parts.push(`${result.duplicated}件はすでに登録済みでした。`);
    if (result.incomplete > 0) {
      parts.push(`${result.incomplete}件は商品名か数量が空のため登録していません。`);
    }
    if (result.failed > 0) parts.push(`${result.failed}件は登録できませんでした（${result.firstError}）。`);
    message = parts.join("");
  } catch (error) {
    redirect(withParams(`/intake/${batchId}`, { error: userFacingMessage(error) }));
  }

  revalidateIntake(batchId);
  revalidatePath("/inventory");
  revalidatePath("/history");
  redirect(withParams(`/intake/${batchId}`, { notice: message }));
}

/** 取り込みを破棄する。 */
export async function discardIntakeAction(formData: FormData): Promise<void> {
  const ctx = await requireInventoryContextForAction();
  const batchId = str(formData, "batchId");

  try {
    await discardIntakeBatch(ctx, { batchId });
  } catch (error) {
    redirect(withParams(`/intake/${batchId}`, { error: userFacingMessage(error) }));
  }

  revalidateIntake(batchId);
  redirect(withParams("/intake", { notice: "取り込みを破棄しました。" }));
}

/**
 * 候補1件を直す。**在庫の登録フォームと同じ入力を使う**ため、検証も
 * `parseStockLotForm()`をそのまま通す（同じ画面で同じ値が通ったり弾かれたりしないように）。
 */
export async function updateIntakeCandidateAction(
  _prevState: InventoryFormState,
  formData: FormData,
): Promise<InventoryFormState> {
  const ctx = await requireInventoryContextForAction();
  const input = rawInput(formData);

  const parsed = parseStockLotForm(input);
  if (!parsed.ok) return { errors: parsed.errors, values: input };

  const candidateId = str(formData, "candidateId");
  const batchId = str(formData, "batchId");

  try {
    await updateIntakeCandidate(ctx, { candidateId, ...parsed.value });
  } catch (error) {
    return { errors: { form: userFacingMessage(error) }, values: input };
  }

  revalidateIntake(batchId);
  redirect(withParams(`/intake/${batchId}`, { notice: "候補を直しました。" }));
}

/** 写真取込の設定を保存する。 */
export async function saveIntakeSettingsAction(
  _prevState: InventoryFormState,
  formData: FormData,
): Promise<InventoryFormState> {
  const ctx = await requireInventoryContextForAction();
  const input = rawInput(formData);

  try {
    await saveIntakeSettings(ctx, assertIntakeSettings(input));
  } catch (error) {
    if (error instanceof InventoryInputError) {
      return { errors: { [error.field]: error.message }, values: input };
    }
    return { errors: { form: userFacingMessage(error) }, values: input };
  }

  revalidatePath("/intake/settings");
  revalidateIntake();
  redirect(withParams("/intake/settings", { notice: "写真取込の設定を保存しました。" }));
}

/** 保存されている画像をすべて消す。候補と在庫はそのまま残る。 */
export async function deleteIntakeImagesAction(): Promise<void> {
  const ctx = await requireInventoryContextForAction();

  let count: number;
  try {
    count = await deleteAllIntakeImages(ctx);
  } catch (error) {
    redirect(withParams("/intake/settings", { error: userFacingMessage(error) }));
  }

  revalidatePath("/intake/settings");
  revalidateIntake();
  redirect(
    withParams("/intake/settings", {
      notice: `保存されていた画像${count}枚を削除しました。候補と在庫はそのまま残っています。`,
    }),
  );
}
