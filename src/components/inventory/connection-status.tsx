"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudOff, RefreshCw } from "lucide-react";

import { useOnlineStatus } from "./use-online-status";

/**
 * 画面のいちばん上に出る、同期とオフラインの帯（#12）。
 *
 * **出るのは2つの状態だけ**で、それ以外のときは何も描かない。常設の「同期中」表示は場所を
 * 取るだけで読まれなくなり、いざ異常が出たときにも気付かれない。
 *
 * 1. ほかの端末で在庫が動いた → 「最新にする」を押すと`router.refresh()`で読み直す
 * 2. オフライン → いつの内容を見ているのかを出す（記録できないことは`SubmitButton`側でも出る）
 *
 * **比較の基準は、サーバーが描いた版（`revision`）そのものを毎回propで受け取る。**
 * クライアント側に基準を持たせると、自分で記録したあとにも「ほかの端末で更新されました」が
 * 出続ける（自分の更新も版を進めるため）。propなら、画面が再描画されるたびに基準が
 * 最新へ揃うので、押した本人には出ない。
 */
const POLL_INTERVAL_MS = 30_000;

/** 帯の高さ。`PageHeader`の`sticky`の位置をこのぶん下げるため、CSS変数で全体へ渡す。 */
const BANNER_HEIGHT = "2.25rem";

export function ConnectionStatus({
  revision,
  loadedAt,
}: {
  readonly revision: string | null;
  /** サーバーがこの画面を描いた時刻（日本時間）。オフラインのとき「いつの内容か」に使う。 */
  readonly loadedAt: string;
}) {
  const router = useRouter();
  const online = useOnlineStatus();
  const [remoteRevision, setRemoteRevision] = useState<string | null>(null);
  const [baseline, setBaseline] = useState(revision);

  // サーバーが描き直した（＝新しい基準が届いた）ら、比較をやり直す。
  // 描画中に前回のpropと突き合わせて捨てるのは、Reactが勧めている形
  // （https://react.dev/reference/react/useState#storing-information-from-previous-renders）。
  // 効果（useEffect）でやると、古い基準のまま1回描いてから直すことになる。
  if (baseline !== revision) {
    setBaseline(revision);
    setRemoteRevision(null);
  }

  const check = useCallback(async () => {
    if (document.visibilityState !== "visible") return;

    try {
      const response = await fetch("/api/inventory/revision", { cache: "no-store" });
      if (!response.ok) return;

      const data: unknown = await response.json();
      const next = (data as { revision?: unknown }).revision;
      if (typeof next === "string") setRemoteRevision(next);
    } catch {
      // 通信できなかっただけ。オフラインの判定は`useOnlineStatus()`が持つので、
      // ここでは何も出さずに次の周期へ譲る。
    }
  }, []);

  useEffect(() => {
    if (!online || revision === null) return;

    // 画面が見えているあいだだけ回す。バックグラウンドのタブが家族の人数ぶん
    // 問い合わせ続けると、読まれない情報のためにDBを引くことになる。
    //
    // 貼った直後に1回叩かないのは、いま描かれたばかりの画面が最新だから
    // （`revision`はこのレンダーでサーバーが数えた値そのもの）。
    const timer = window.setInterval(check, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [check, online, revision]);

  const updated = remoteRevision !== null && revision !== null && remoteRevision !== revision;
  const visible = !online || updated;

  // `PageHeader`は`sticky top-[var(--app-banner-h,0px)]`で貼り付いている。帯を出している
  // あいだだけこの変数を立て、見出しが帯の下へ回り込まないようにする。
  useEffect(() => {
    const root = document.documentElement;
    if (visible) root.style.setProperty("--app-banner-h", BANNER_HEIGHT);
    else root.style.removeProperty("--app-banner-h");

    return () => {
      root.style.removeProperty("--app-banner-h");
    };
  }, [visible]);

  if (!visible) return null;

  if (!online) {
    return (
      <div
        role="status"
        className="sticky top-0 z-30 flex h-9 items-center gap-2 border-b border-amber-300 bg-amber-50 px-4 text-xs text-amber-800 md:px-6 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
      >
        <CloudOff className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">
          オフラインです。表示は{loadedAt}に読み込んだ内容で、記録はできません。
        </span>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="sticky top-0 z-30 flex h-9 items-center gap-2 border-b border-emerald-300 bg-emerald-50 px-4 text-xs text-emerald-800 md:px-6 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
    >
      <RefreshCw className="size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">ほかの端末で在庫が更新されました。</span>
      <button
        type="button"
        onClick={() => router.refresh()}
        className="ml-auto shrink-0 rounded-md border border-current px-2 py-0.5 font-semibold"
      >
        最新にする
      </button>
    </div>
  );
}
