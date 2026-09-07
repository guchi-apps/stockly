#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# next devは.env.localを自動で読み込むが、このスクリプト自身（bash）は読まないため明示的に読む。
# 開発サーバーのポートは.env.localのPORTで決まる（Issueごとのworktreeでは 28000 + Issue番号）。
if [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

exec next dev -p "${PORT:-3000}"
