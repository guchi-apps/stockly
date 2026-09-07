import { Boxes } from "lucide-react";

import { isDevLoginEnabled } from "@/lib/auth/dev-login";
import { resolveInternalPath } from "@/lib/auth/internal-path";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const ERROR_MESSAGES: Record<string, string> = {
  auth_failed: "ログインに失敗しました。もう一度お試しください。",
  not_allowed: "このGoogleアカウントではStocklyを利用できません。",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = resolveInternalPath(firstValue(params.next));
  const errorMessage = ERROR_MESSAGES[firstValue(params.error) ?? ""];

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-12">
      <Card>
        <CardHeader>
          <Boxes className="text-primary size-6" aria-hidden />
          <CardTitle className="mt-2 text-xl">Stockly にログイン</CardTitle>
          <CardDescription>
            家庭の在庫を扱うため、許可されたGoogleアカウントだけが利用できます。
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {errorMessage ? (
            <p role="alert" className="text-destructive text-sm">
              {errorMessage}
            </p>
          ) : null}

          {/*
            リンクにしているのは、クライアントJSのハイドレーションが終わる前でも押せるようにするため。
            onClickでsignInWithOAuth()を呼ぶと、ボタンは見えているのに押しても何も起きない時間ができる。
          */}
          <Button asChild size="lg" className="w-full">
            <a href={`/auth/signin?next=${encodeURIComponent(next)}`}>Googleでログイン</a>
          </Button>

          {isDevLoginEnabled() ? (
            <form action={`/api/dev/login?next=${encodeURIComponent(next)}`} method="post">
              {/*
                開発・CI限定のログイン（本番では isDevLoginEnabled() が偽になり、この導線自体が出ない）。
                GUIの無いsubpcやCIから、ログインの背後にある画面を確認するために使う。
              */}
              <Button type="submit" variant="outline" size="lg" className="w-full">
                開発用ダミーユーザーでログイン
              </Button>
            </form>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}

/** 同じクエリが複数回付いた場合は先頭を使う（`?next=/a&next=/b`）。 */
function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
