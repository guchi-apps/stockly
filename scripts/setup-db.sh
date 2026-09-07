#!/usr/bin/env bash
# `.env.local` の DATABASE_URL に書いたDB・ユーザーをローカルのMariaDB/MySQLへ作る（開発用）。
#
#   pnpm env:init   # 初回のみ（.env.local.example をコピー）
#   pnpm db:setup
#   pnpm db:migrate:dev
#
# 前提: `sudo mysql` でroot接続できること（MariaDB/MySQLが起動済みであること）。
# `prisma migrate dev` はシャドウDB上でDDLを実行するため、*.* へのCREATE/DROP等も要る。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env.local"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE がありません。先に pnpm env:init を実行してください。" >&2
  exit 1
fi

DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | tail -n1 | cut -d= -f2-)"
# dotenvは値を囲むクォートを取り除くが、このスクリプトは行をそのまま読むためここで外す。
DATABASE_URL="${DATABASE_URL%\"}"; DATABASE_URL="${DATABASE_URL#\"}"
DATABASE_URL="${DATABASE_URL%\'}"; DATABASE_URL="${DATABASE_URL#\'}"

if [[ -z "$DATABASE_URL" ]]; then
  echo "Error: $ENV_FILE に DATABASE_URL がありません。" >&2
  exit 1
fi

read -r DB_USER DB_PASSWORD DB_NAME <<<"$(python3 -c "
import urllib.parse
u = urllib.parse.urlparse('$DATABASE_URL')
print(urllib.parse.unquote(u.username or ''), urllib.parse.unquote(u.password or ''), (u.path or '').lstrip('/'))
")"

for var in DB_NAME DB_USER DB_PASSWORD; do
  if [[ -z "${!var:-}" ]]; then
    echo "Error: DATABASE_URL から ${var} を取得できませんでした。" >&2
    exit 1
  fi
done

# 識別子はクォートでエスケープできないため、使える文字を先に絞る。
for var in DB_NAME DB_USER; do
  if [[ ! "${!var}" =~ ^[a-zA-Z0-9_-]+$ ]]; then
    echo "Error: ${var} に使えない文字が含まれています（英数字・_・- のみ）: ${!var}" >&2
    exit 1
  fi
done

DB_PASSWORD_ESC="$(printf '%s' "$DB_PASSWORD" | sed "s/'/''/g")"

echo "セットアップ対象: DB_NAME=${DB_NAME} DB_USER=${DB_USER} DB_PASSWORD=***"

if ! command -v mysql >/dev/null 2>&1; then
  echo "Error: mysql コマンドが見つかりません（sudo apt install mariadb-server）。" >&2
  exit 1
fi

sudo mysql <<EOSQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD_ESC}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD_ESC}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
GRANT CREATE, DROP, ALTER, INDEX, REFERENCES, SELECT, INSERT, UPDATE, DELETE, CREATE TEMPORARY TABLES, LOCK TABLES ON *.* TO '${DB_USER}'@'localhost';

CREATE USER IF NOT EXISTS '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASSWORD_ESC}';
ALTER USER '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASSWORD_ESC}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'127.0.0.1';
GRANT CREATE, DROP, ALTER, INDEX, REFERENCES, SELECT, INSERT, UPDATE, DELETE, CREATE TEMPORARY TABLES, LOCK TABLES ON *.* TO '${DB_USER}'@'127.0.0.1';

FLUSH PRIVILEGES;
EOSQL

echo "接続確認中..."
if mysql -u "$DB_USER" -p"$DB_PASSWORD" -h 127.0.0.1 "$DB_NAME" -e "SELECT 1" >/dev/null 2>&1; then
  echo "OK: DB・ユーザーを作成しました（.env.local の DATABASE_URL で接続できます）"
else
  echo "Error: ユーザーは作成しましたが、DATABASE_URL の認証情報で接続できません。" >&2
  exit 1
fi

echo "次: pnpm db:migrate:dev"
