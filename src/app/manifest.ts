import type { MetadataRoute } from "next";

// PWAとしてホーム画面へ追加できるようにする。オフラインキャッシュ（Service Worker）は
// 初期スコープ外のため持たない（#1）。
export default function manifest(): MetadataRoute.Manifest {
  return {
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
