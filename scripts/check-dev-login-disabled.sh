#!/usr/bin/env bash
# 本番ビルドを実際に起動し、開発用ログイン（POST /api/dev/login）が閉じていることを確かめる（#13）。
#
#   pnpm build:ci                       # 先にビルドしておく
#   bash scripts/check-dev-login-disabled.sh
#
# `src/lib/auth/dev-login.test.ts`は関数単位で「NODE_ENV=productionなら無効」を見ているが、
# それだけでは「ルートやproxyが別の経路で判定している」「NODE_ENVがビルド時に固定されていない」
# といった配線の間違いを見つけられない。ここでは**シークレットをわざと与えたうえで**
# `next start`を起こし、HTTPで次を確かめる。
#
#   1. POST /api/dev/login が 404（開発用ログインの入口そのものが無い）
#   2. 開発用ログインのCookieを付けて / を開いても /login へ戻される（Cookieを信用しない）
#   3. 未ログインで /inventory を開くと /login へ戻される（認証の関門が効いている）
#
# 外部サービスには接続しない。Supabaseのプレースホルダー値はDNSに存在しないホストで、
# セッションCookieが無いリクエストではproxyがSupabaseへ問い合わせない。
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

PORT="${SMOKE_PORT:-3999}"
BASE="http://127.0.0.1:${PORT}"
LOG="$(mktemp)"

if [[ ! -d .next ]]; then
  echo "Error: .next がありません。先に pnpm build:ci を実行してください。" >&2
  exit 2
fi

# ビルド時と同じプレースホルダー。値の形式だけが要り、接続はしない。
export NODE_ENV=production
export DATABASE_URL="${DATABASE_URL:-mysql://placeholder:placeholder@127.0.0.1:3306/app_stockly}"
export NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-https://ci-placeholder.supabase.co}"
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:-ci-placeholder}"
# わざとシークレットを与える。本番ではこれがあっても無効でなければならない。
export CI_LOGIN_BYPASS_SECRET="smoke-test-secret-must-be-ignored-in-production"

pnpm exec next start -p "$PORT" >"$LOG" 2>&1 &
SERVER_PID=$!
cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
  rm -f "$LOG"
}
trap cleanup EXIT

# 起動待ち（最大30秒）。/login は公開パスなので200が返れば起動している。
for _ in $(seq 1 60); do
  if curl -s -o /dev/null "$BASE/login"; then
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "Error: next start が終了しました。" >&2
    cat "$LOG" >&2
    exit 1
  fi
  sleep 0.5
done

failures=0

check() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "ok   ${label}: ${actual}"
  else
    echo "FAIL ${label}: expected ${expected}, got ${actual}"
    failures=$((failures + 1))
  fi
}

status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/dev/login")
check "POST /api/dev/login は本番では404" "404" "$status"

redirect=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' \
  -H "Cookie: ci-login-bypass=${CI_LOGIN_BYPASS_SECRET}" "$BASE/")
check "開発用ログインのCookieは本番では信用されない（/ → /login）" \
  "307 ${BASE}/login?next=%2F" "$redirect"

redirect=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$BASE/inventory")
check "未ログインの /inventory は /login へ戻る" "307 ${BASE}/login?next=%2Finventory" "$redirect"

if [[ "$failures" -gt 0 ]]; then
  echo "開発用ログインの無効化・認証の関門の確認に失敗しました（${failures}件）。" >&2
  echo "--- next start のログ ---" >&2
  cat "$LOG" >&2
  exit 1
fi

echo "本番ビルドで開発用ログインが無効であることを確認しました。"
