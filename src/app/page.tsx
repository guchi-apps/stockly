import { Boxes, ShieldCheck, ShoppingBasket } from "lucide-react";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// アプリ基盤の初期化Issue（#1）で置いた暫定のトップページ。
// 在庫一覧・登録などの画面は後続Issueでここを置き換える。
const upcoming = [
  {
    icon: Boxes,
    title: "在庫を一元管理する",
    description: "食材・飲料・日用品・防災用品を、保管場所と残量で把握できるようにします。",
  },
  {
    icon: ShoppingBasket,
    title: "買い物リストへつなぐ",
    description: "在庫はStocklyを正本とし、補充候補を買い物リスト（Notion）へ連携します。",
  },
  {
    icon: ShieldCheck,
    title: "備蓄を自動で集計する",
    description: "日常の在庫から、非常時に使える物と何日分あるかを自動で集計します。",
  },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Stockly</h1>
        <p className="text-muted-foreground text-balance">
          食材・飲料・日用品・防災用品を一元管理し、日常の在庫から非常時に使える備蓄を自動集計する家庭在庫アプリです。
        </p>
        <p className="text-muted-foreground text-sm">
          現在はアプリの基盤だけを用意した状態です。画面と機能は今後のIssueで追加します。
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        {upcoming.map(({ icon: Icon, title, description }) => (
          <Card key={title}>
            <CardHeader>
              <Icon className="text-primary size-5" aria-hidden />
              <CardTitle className="mt-2 text-base">{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>
    </main>
  );
}
