/**
 * Stocklyを利用してよいアカウントかを判定する。
 *
 * Supabaseは他アプリと共有のプロジェクトなので、**Supabaseで認証できることは
 * Stocklyを使ってよいことを意味しない**。両者を分けて判定するための関数で、
 * 許可メールは環境変数`ALLOWED_GOOGLE_EMAILS`にカンマ区切りで設定する。
 *
 * 未設定のときに全員を通すと、設定漏れがそのまま公開になる。fail-closedにして全員拒否する。
 * 一般公開する場合は、この関数だけを変えれば済むよう判定を1か所へ閉じている。
 */
export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;

  const allowed = (process.env.ALLOWED_GOOGLE_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (allowed.length === 0) return false;

  return allowed.includes(email.toLowerCase());
}
