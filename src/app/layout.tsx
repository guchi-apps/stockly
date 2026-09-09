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
  width: "device-width",
  initialScale: 1,
  // **`env(safe-area-inset-*)`はこれが無いと常に0を返す**（#12）。ホーム画面から起動した
  // iPhoneで画面の端まで描くための指定で、下タブの`pb-[env(safe-area-inset-bottom)]`や
  // 横向きの左右の余白は、この1行が入って初めて効く。
  viewportFit: "cover",
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
