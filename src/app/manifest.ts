import type { MetadataRoute } from "next";

// PWAとしてホーム画面へ追加できるようにする。オフラインキャッシュ（Service Worker）は
// 初期スコープ外のため持たない（#1）。
export default function manifest(): MetadataRoute.Manifest {
  return {
    // `id`と`scope`を明示しておく（#12）。`id`が無いと、`start_url`を変えたときにOSが
    // 別アプリとみなしてホーム画面のアイコンが二重になる。`scope`の外へ出たリンクは
    // ブラウザで開かれるので、アプリの範囲を`/`で閉じておく。
    id: "/",
    scope: "/",
    name: "Stockly",
    short_name: "Stockly",
    description: "食材・飲料・日用品・防災用品を一元管理する家庭在庫アプリ",
    start_url: "/",
    display: "standalone",
    lang: "ja",
    // OSが出す起動画面の地の色。アイコンの背景と同じにすると、図柄だけが浮いて見えない。
    background_color: "#047857",
    theme_color: "#047857",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
