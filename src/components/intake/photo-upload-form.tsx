"use client";

import { useRef, useState } from "react";
import { Camera, Images, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { INTAKE_IMAGE_KINDS, INTAKE_IMAGE_KIND_LABELS, type IntakeImageKind } from "@/lib/intake/prompt";

/**
 * 写真を選んで取り込む欄（#10）。
 *
 * **`action`にServer Actionをそのまま渡す**（`useActionState`にしない）。こうしておくと
 * HTMLに`$ACTION_ID_…`が出るため、GUIの無い環境でも`curl -F`で動かして確かめられる
 * （CLAUDE.mdの「GUIが無い環境でServer Actionまで確かめる」）。
 *
 * **送る前にブラウザ側で縮小する。** iPhoneの写真はそのままだと1枚3〜5MBあり、
 * 読み取りに要らない解像度ぶんの入力トークンを毎回払うことになる。長辺1600pxのJPEGにすると
 * 1枚300KB程度に収まり、レシートの文字は十分読める。
 * 縮小は`<input type="file">`の中身そのものを差し替える形で行うので、**JSが動かなかった場合は
 * 元の画像がそのまま送られる**（大きいだけで、取り込みは成立する）。
 */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;

interface Picked {
  readonly file: File;
  readonly url: string;
  readonly kind: IntakeImageKind;
}

export function PhotoUploadForm({
  action,
  maxImages,
  disabled = false,
  disabledReason,
}: {
  action: (formData: FormData) => void | Promise<void>;
  maxImages: number;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /** 選ばれた画像を縮小し、input本体の中身を縮小後のファイルへ差し替える。 */
  const handleChange = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) return;
    setWorking(true);
    setMessage(null);

    const next: Picked[] = [];
    for (const file of Array.from(files).slice(0, maxImages)) {
      try {
        const shrunk = await shrink(file);
        next.push({ file: shrunk, url: URL.createObjectURL(shrunk), kind: guessKind(file.name) });
      } catch {
        // 縮小できない形式（HEICなど）は元のまま渡し、受け付けられるかはサーバーに任せる。
        next.push({ file, url: URL.createObjectURL(file), kind: guessKind(file.name) });
      }
    }

    if (files.length > maxImages) {
      setMessage(`写真は1回に${maxImages}枚までです。先頭の${maxImages}枚だけを使います。`);
    }

    picked.forEach((item) => URL.revokeObjectURL(item.url));
    setPicked(next);
    syncInput(next);
    setWorking(false);
  };

  const syncInput = (items: readonly Picked[]): void => {
    const input = inputRef.current;
    if (!input) return;
    const transfer = new DataTransfer();
    items.forEach((item) => transfer.items.add(item.file));
    input.files = transfer.files;
  };

  const remove = (index: number): void => {
    const next = picked.filter((_, i) => i !== index);
    URL.revokeObjectURL(picked[index].url);
    setPicked(next);
    syncInput(next);
  };

  const changeKind = (index: number, kind: IntakeImageKind): void => {
    setPicked(picked.map((item, i) => (i === index ? { ...item, kind } : item)));
  };

  return (
    <form action={action} className="flex flex-col gap-4 rounded-xl border p-4">
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-6 text-center">
        <Camera className="text-muted-foreground size-7" aria-hidden />
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            type="button"
            className="h-11"
            onClick={() => inputRef.current?.click()}
            disabled={disabled || working}
          >
            <Images className="size-4" aria-hidden />
            写真を選ぶ・撮る
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          1回に{maxImages}枚まで・1枚10MBまで。送る前に長辺{MAX_EDGE}pxのJPEGへ縮めます。
        </p>
      </div>

      {/*
        capture属性は付けない。付けるとAndroidでカメラしか開けなくなり、
        すでに撮ってある写真を選べなくなる。カメラはOSの選択画面から開ける。
      */}
      <input
        ref={inputRef}
        type="file"
        name="photos"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="sr-only"
        onChange={(event) => void handleChange(event.target.files)}
      />

      {message ? (
        <p role="status" className="text-muted-foreground text-xs">
          {message}
        </p>
      ) : null}

      {picked.length > 0 ? (
        <ul className="flex flex-wrap gap-3">
          {picked.map((item, index) => (
            <li key={item.url} className="w-28 overflow-hidden rounded-xl border">
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- ブラウザ内のobject URLで、最適化の対象にできない */}
                <img src={item.url} alt="" className="h-24 w-full object-cover" />
                <button
                  type="button"
                  onClick={() => remove(index)}
                  aria-label={`${index + 1}枚目を外す`}
                  className="bg-background/90 absolute top-1 right-1 rounded-full border p-1"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </div>
              <select
                name="kind"
                value={item.kind}
                onChange={(event) => changeKind(index, event.target.value as IntakeImageKind)}
                aria-label={`${index + 1}枚目の種類`}
                className="w-full border-t bg-transparent px-2 py-1.5 text-xs"
              >
                {INTAKE_IMAGE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {INTAKE_IMAGE_KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton count={picked.length} disabled={disabled || working} />
        {disabled && disabledReason ? (
          <p className="text-destructive text-xs font-semibold">{disabledReason}</p>
        ) : (
          <p className="text-muted-foreground text-xs">
            読み取りには20秒ほどかかります。結果は取り込みの記録に残るので、待たずに閉じても構いません。
          </p>
        )}
      </div>
    </form>
  );
}

function SubmitButton({ count, disabled }: { count: number; disabled: boolean }) {
  return (
    <Button type="submit" className="h-11 min-w-44" disabled={disabled || count === 0}>
      {count === 0 ? "候補を作る" : `候補を作る（${count}枚）`}
    </Button>
  );
}

/** ファイル名から種類を当てる。外れても画面で直せるので、当たらなければ「おまかせ」。 */
function guessKind(name: string): IntakeImageKind {
  const lower = name.toLowerCase();
  if (lower.includes("receipt") || name.includes("レシート")) return "RECEIPT";
  return "UNKNOWN";
}

/**
 * 長辺を`MAX_EDGE`に収めたJPEGへ変換する。
 *
 * `createImageBitmap`で読むのは、`<img>`経由より速くEXIFの向きも尊重されるため。
 * 変換できない形式ではそのまま例外を投げ、呼び出し側が元のファイルを使う。
 */
async function shrink(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas is unavailable");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  if (!blob) throw new Error("failed to encode");

  return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.jpg`, { type: "image/jpeg" });
}
