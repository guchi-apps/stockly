"use client";

import { useId, useRef, useState } from "react";
import { Camera, ImagePlus, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * 写真を選ぶ欄（#11）。
 *
 * **フォームそのものはサーバーコンポーネントのままにしてある。** ここが差し替えるのは
 * `<input type="file">`の中身だけで、JSが動かない環境でも同じフォームがそのまま送信できる
 * （送信の経路を2つに分けない）。
 *
 * JSが動くときにやることは2つ。
 *
 * 1. **iPhoneのHEICをJPEGへ変換する。** サーバーはHEICを受け取らない（EXIFを外すのに
 *    追加の依存が要るため）。canvasへ描き直すと画素だけが残るので、変換がそのまま
 *    位置情報の除去にもなる
 * 2. **長辺1568pxまで縮める。** モデルはそれ以上を受け取っても内部で縮めるだけで、
 *    送信量と待ち時間、そして費用が増える
 *
 * 変換した結果は`DataTransfer`で同じ`<input>`へ書き戻すので、送信は通常のフォーム送信のまま。
 */

/**
 * 選べる形式。**サーバーが受け取るのはJPEG・PNG・WebPだけ**（`src/lib/intake/image.ts`の
 * `IMAGE_TYPES`）で、HEIC/HEIFはここでJPEGへ変換してから送る。変換できなかった場合は
 * サーバーが理由付きで断る。
 */
const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif";

/** モデルが内部で縮める境目。これより大きく送っても精度は上がらない。 */
const MAX_EDGE = 1568;

/** 変換後のJPEG品質。文字が読めればよいので、見た目の劣化より容量を優先する。 */
const JPEG_QUALITY = 0.82;

interface Selected {
  readonly name: string;
  readonly url: string;
  readonly kb: number;
}

export function ConsumePhotoInput({ maxImages }: { maxImages: number }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [selected, setSelected] = useState<readonly Selected[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = [...(event.target.files ?? [])];
    if (files.length === 0) {
      setSelected([]);
      return;
    }
    if (files.length > maxImages) {
      setMessage(`写真は一度に${maxImages}枚までです。選び直してください。`);
      event.target.value = "";
      setSelected([]);
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const converted = await Promise.all(files.map(shrinkToJpeg));
      // 変換できたぶんだけを書き戻す。1枚でも失敗したら、元のまま送ってサーバーの判定に任せる
      // （ここで黙って捨てると、写したはずのものが候補に出ない理由が分からなくなる）。
      if (converted.every((file) => file !== null)) {
        const transfer = new DataTransfer();
        for (const file of converted) transfer.items.add(file as File);
        if (inputRef.current) inputRef.current.files = transfer.files;
      }

      const list = [...(inputRef.current?.files ?? [])];
      setSelected(
        list.map((file) => ({
          name: file.name,
          url: URL.createObjectURL(file),
          kb: Math.max(1, Math.round(file.size / 1024)),
        })),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        name="images"
        multiple
        accept={ACCEPT}
        capture="environment"
        onChange={(event) => void handleChange(event)}
        className="sr-only"
      />

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          className="h-11 flex-1 sm:flex-none"
          onClick={() => inputRef.current?.click()}
        >
          <Camera className="size-4" aria-hidden />
          カメラで撮る
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 flex-1 sm:flex-none"
          onClick={() => {
            // ファイルから選ぶときはカメラを直接開かせない（`capture`を外して押す）。
            const input = inputRef.current;
            if (!input) return;
            input.removeAttribute("capture");
            input.click();
            input.setAttribute("capture", "environment");
          }}
        >
          <ImagePlus className="size-4" aria-hidden />
          写真を選ぶ
        </Button>
      </div>

      {busy ? (
        <p className="text-muted-foreground flex items-center gap-2 text-xs">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          送れる大きさに整えています…
        </p>
      ) : null}

      {selected.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {selected.map((file) => (
            <li key={file.url} className="flex flex-col items-center gap-1">
              {/* 選んだ写真の確認だけの表示。next/imageは外部・動的なblobを扱わないため使わない。 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={file.url}
                alt={file.name}
                className="size-16 rounded-lg border object-cover"
              />
              <span className="text-muted-foreground font-mono text-[10px]">{file.kb}KB</span>
            </li>
          ))}
        </ul>
      ) : null}

      {message ? (
        <p role="alert" className="text-destructive text-xs font-semibold">
          {message}
        </p>
      ) : null}
    </div>
  );
}

/**
 * 画像を長辺`MAX_EDGE`までのJPEGへ描き直す。変換できなければ`null`。
 *
 * `createImageBitmap`はブラウザが読める形式なら何でも扱えるので、iOSのHEICもここを通る。
 * 描き直した時点でEXIFは残らない（canvasは画素しか持たない）。
 */
async function shrinkToJpeg(file: File): Promise<File | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!blob) return null;

    return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.jpg`, { type: "image/jpeg" });
  } catch {
    return null;
  }
}
