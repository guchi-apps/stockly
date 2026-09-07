import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Stockly",
  description: "食材・飲料・日用品・防災用品を一元管理し、日常の在庫から非常時に使える備蓄を自動集計する家庭在庫アプリ",
  // ホーム画面から起動したときにブラウザUIを出さない（PWA manifestのdisplay: standaloneと対になる）。
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Stockly",
  },
};

export const viewport: Viewport = {
  // globals.cssの--background（ライト/ダーク）と同じ色。OSのステータスバーを地の色に馴染ませる。
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#242424" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
