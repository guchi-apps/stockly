"use client";

import { useSyncExternalStore } from "react";

/**
 * いま通信できるか（#12）。
 *
 * `navigator.onLine`はサーバー側に存在しないため、SSRの1回目は必ず「オンライン」とみなす
 * （`getServerSnapshot`）。最初の描画をオフライン前提にすると、通信できている端末でも
 * 一瞬ボタンが押せない状態が出るうえ、hydrationの不一致になる。
 *
 * `navigator.onLine`が見ているのは端末のネットワーク接続であって、サーバーへ届くかどうかでは
 * ない。**「falseなら確実に送れない」ほうだけを信じて使う**（trueでも失敗はしうるが、それは
 * 送信そのもののエラーとして出る）。
 */
function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener("online", onStoreChange);
  window.addEventListener("offline", onStoreChange);
  return () => {
    window.removeEventListener("online", onStoreChange);
    window.removeEventListener("offline", onStoreChange);
  };
}

function getSnapshot(): boolean {
  return navigator.onLine;
}

function getServerSnapshot(): boolean {
  return true;
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
