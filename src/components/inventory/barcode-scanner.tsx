"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CameraOff, Loader2, ScanLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseBarcode, symbologyFromDetectedFormat } from "@/lib/barcode/code";
import { InventoryInputError } from "@/lib/inventory/operations";

/**
 * カメラでバーコードを読み取る画面（#9）。
 *
 * **読み取りは`BarcodeDetector`のAPI一本で書く。** 標準実装があるブラウザ（Chrome・Edge・Android）は
 * それをそのまま使い、無いブラウザ（iOS Safari）でだけ同じAPIのponyfill（ZXingのWebAssembly）を
 * 動的importで読む。標準実装がある環境へ1MBのwasmを配らないため、静的importにはしない。
 *
 * **どの状態でも手入力欄は同じ位置に出す。** カメラが使えないこと（権限拒否・非対応・
 * httpsでない）は珍しくなく、そのときに登録までたどり着けないと、この画面を開く意味が無くなる。
 */

/** 読み取る対象。増やすほど1コマあたりの処理が重くなるので、家庭の在庫で使うものだけにする。 */
const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"] as const;

/** 1秒あたりの読み取り回数。上げても手ぶれで読めるようにはならず、電池を使うだけ。 */
const SCANS_PER_SECOND = 5;

interface DetectedBarcodeLike {
  readonly rawValue: string;
  readonly format: string;
}

interface DetectorLike {
  detect(source: CanvasImageSource): Promise<readonly DetectedBarcodeLike[]>;
}

type ScannerStatus = "idle" | "starting" | "scanning" | "denied" | "unsupported" | "failed";

/**
 * 読み取り器を作る。標準実装があればそれを、無ければponyfillを使う。
 *
 * wasmはjsDelivrのCDNが既定の取得先になっているため、`locateFile`で自前配信へ差し替える
 * （外部CDNへ出さない。ファイル名にバージョンを入れてあるので、依存を上げて差し替えを
 * 忘れると404で気付ける）。
 */
async function createDetector(): Promise<DetectorLike> {
  const native = (globalThis as { BarcodeDetector?: new (options: object) => DetectorLike })
    .BarcodeDetector;
  if (native) {
    try {
      return new native({ formats: [...FORMATS] });
    } catch {
      // 標準実装があっても、この形式に対応していないことがある。その場合はponyfillへ落とす。
    }
  }

  const { BarcodeDetector, prepareZXingModule, ZXING_WASM_VERSION } = await import(
    "barcode-detector/ponyfill"
  );
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) =>
        path.endsWith(".wasm") ? `/zxing/zxing_reader-${ZXING_WASM_VERSION}.wasm` : prefix + path,
    },
  });
  return new BarcodeDetector({ formats: [...FORMATS] }) as DetectorLike;
}

export function BarcodeScanner() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // 読み取れた瞬間に画面遷移するが、遷移が終わるまでループが回り続けるため、
  // 二重に`router.push()`しないようにここで止める。
  const handledRef = useRef(false);

  const [status, setStatus] = useState<ScannerStatus>("idle");
  const [manualCode, setManualCode] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const manualId = useId();

  const goToRegister = useCallback(
    (code: string, symbology: string, from: "scan" | "manual") => {
      const params = new URLSearchParams({ code, sym: symbology, from });
      router.push(`/inventory/new?${params.toString()}`);
    },
    [router],
  );

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const stop = (): void => {
      if (timer) clearTimeout(timer);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };

    const start = async (): Promise<void> => {
      // getUserMediaはhttpsとlocalhostでしか生えない。LANのIPで開いたときはここに来る。
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("unsupported");
        return;
      }

      setStatus("starting");

      let detector: DetectorLike;
      try {
        detector = await createDetector();
      } catch {
        setStatus("unsupported");
        return;
      }
      if (cancelled) return;

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
        });
      } catch (error) {
        if (cancelled) return;
        const name = error instanceof DOMException ? error.name : "";
        setStatus(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "failed");
        return;
      }

      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      // iOS Safariは`playsInline`が無いと全画面の動画プレイヤーを開いてしまう（JSXでも指定済み）。
      await video.play().catch(() => undefined);
      setStatus("scanning");

      const tick = async (): Promise<void> => {
        if (cancelled || handledRef.current) return;

        try {
          const found = await detector.detect(video);
          const first = found[0];
          if (first?.rawValue) {
            const parsed = parseBarcode(first.rawValue);
            handledRef.current = true;
            stop();
            goToRegister(
              parsed.code,
              symbologyFromDetectedFormat(first.format, parsed.code),
              "scan",
            );
            return;
          }
        } catch {
          // 1コマ読めなかっただけ。次のコマで読み直す（ここで止めると、手ぶれのたびに
          // カメラが落ちることになる）。
        }

        timer = setTimeout(() => void tick(), 1000 / SCANS_PER_SECOND);
      };

      void tick();
    };

    void start();

    return () => {
      cancelled = true;
      stop();
    };
  }, [goToRegister]);

  const submitManual = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    try {
      const parsed = parseBarcode(manualCode, "manualCode");
      setManualError(null);
      goToRegister(parsed.code, parsed.symbology, "manual");
    } catch (error) {
      if (error instanceof InventoryInputError) {
        setManualError(error.message);
        return;
      }
      throw error;
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <CameraPanel status={status} videoRef={videoRef} />

      <form onSubmit={submitManual} className="flex flex-col gap-2">
        <Label htmlFor={manualId} className="text-xs font-semibold">
          コードを手で入力
        </Label>
        <div className="flex gap-2">
          <Input
            id={manualId}
            name="manualCode"
            value={manualCode}
            onChange={(event) => setManualCode(event.target.value)}
            inputMode="numeric"
            autoComplete="off"
            placeholder="13桁の数字"
            className="h-11 flex-1 font-mono text-base tracking-widest"
          />
          <Button type="submit" className="h-11">
            このコードで探す
          </Button>
        </div>
        {manualError ? (
          <p role="alert" className="text-destructive text-xs font-semibold">
            {manualError}
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">
            読み取れないときは、パッケージの13桁（EAN-8は8桁）を入れてください。
          </p>
        )}
      </form>
    </div>
  );
}

function CameraPanel({
  status,
  videoRef,
}: {
  status: ScannerStatus;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-neutral-900 md:aspect-video">
      <video
        ref={videoRef}
        muted
        playsInline
        aria-label="カメラの映像"
        className="size-full object-cover"
      />

      {status === "scanning" ? (
        <>
          {/* 読み取り枠。実際にはコマ全体を読んでいるが、枠に合わせると距離とぶれが安定する。 */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-[14%] top-1/2 h-[26%] -translate-y-1/2 rounded-lg border-2 border-white/90 shadow-[0_0_0_9999px_rgba(10,12,15,0.45)]"
          />
          <p className="absolute inset-x-0 bottom-3 text-center text-sm text-white drop-shadow">
            枠の中にバーコードを合わせてください
          </p>
        </>
      ) : (
        <CameraMessage status={status} />
      )}
    </div>
  );
}

function CameraMessage({ status }: { status: ScannerStatus }) {
  const content = {
    idle: {
      icon: <ScanLine className="size-7" aria-hidden />,
      title: "カメラを準備しています",
      body: "",
    },
    starting: {
      icon: <Loader2 className="size-7 animate-spin" aria-hidden />,
      title: "カメラを使ってよいか聞いています",
      body: "ブラウザの確認に「許可」を選ぶと、読み取りが始まります。",
    },
    denied: {
      icon: <CameraOff className="size-7" aria-hidden />,
      title: "カメラの使用が許可されていません",
      body: "Safariの「ぁあ」ボタン →「Webサイトの設定」→「カメラ」を「許可」にすると使えます。このまま手入力でも登録できます。",
    },
    unsupported: {
      icon: <CameraOff className="size-7" aria-hidden />,
      title: "このブラウザでは読み取れません",
      body: "コードを手で入力すれば、同じように前回の内容を呼び出せます。（httpで開いている場合、カメラはhttpsかlocalhostでしか使えません）",
    },
    failed: {
      icon: <CameraOff className="size-7" aria-hidden />,
      title: "カメラを開けませんでした",
      body: "他のアプリがカメラを使っていないか確かめてください。このまま手入力でも登録できます。",
    },
    scanning: { icon: null, title: "", body: "" },
  }[status];

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center text-white">
      <span className="text-white/70">{content.icon}</span>
      <b className="text-sm font-semibold">{content.title}</b>
      {content.body ? (
        <p className="max-w-sm text-xs leading-relaxed text-white/70">{content.body}</p>
      ) : null}
    </div>
  );
}
