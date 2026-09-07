#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# ポートの決め方は「環境変数PORT → .env.localのPORT → 3000」の順。
# issue-deckのセッションランチャーは環境変数PORTでworktreeごとのポート（28000 + Issue番号）を
# 渡してくる（guchi-apps/issue-deck#2464）。このリポジトリの本体チェックアウトにはenvファイルが
# 無く、worktreeにも配られないため、.env.local前提にすると渡されたポートを取りこぼす。
port_from_env="${PORT:-}"

# next devは.env.localを自動で読み込むが、このスクリプト自身（bash）は読まないため明示的に読む。
if [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

exec next dev -p "${port_from_env:-${PORT:-3000}}"
