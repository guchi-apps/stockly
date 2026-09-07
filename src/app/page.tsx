import { Boxes, ShieldCheck, ShoppingBasket } from "lucide-react";

import { getCurrentSession } from "@/lib/auth/current-user";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";

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

export default async function Home() {
  // 未ログインなら src/proxy.ts が /login へ戻すため、ここへ来る時点でログイン済み。
  // セッションの検証はproxyが済ませているので、ここで getUser() は呼ばない。
  const session = await getCurrentSession();
  const household = session?.householdId
    ? await db.household.findUnique({ where: { id: session.householdId } })
    : null;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">Stockly</h1>
          {session ? (
            <form action="/auth/signout" method="post" className="flex items-center gap-3">
              <span className="text-muted-foreground text-sm">
                {session.user.name ?? session.user.email}
              </span>
              <Button type="submit" variant="outline" size="sm">
                ログアウト
              </Button>
            </form>
          ) : null}
        </div>

        <p className="text-muted-foreground text-balance">
          食材・飲料・日用品・防災用品を一元管理し、日常の在庫から非常時に使える備蓄を自動集計する家庭在庫アプリです。
        </p>

        {household ? (
          <p className="text-muted-foreground text-sm">
            いま見ている家庭: <span className="text-foreground font-medium">{household.name}</span>
            （在庫はこの家庭に所属する人だけが見られます）
          </p>
        ) : null}

        <p className="text-muted-foreground text-sm">
          現在はログインと家庭の境界までを用意した状態です。在庫の画面は今後のIssueで追加します。
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
