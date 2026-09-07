import { redirect } from "next/navigation";

/**
 * トップページは在庫一覧への入口。
 *
 * ログインしていなければ`src/proxy.ts`が`/login`へ返すので、ここへ来る時点でログイン済み。
 * PWAの`start_url`（`src/app/manifest.ts`）が`/`のため、ホーム画面から起動しても在庫が開く。
 */
export default function Home() {
  redirect("/inventory");
}
