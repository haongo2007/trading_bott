#!/usr/bin/env bash
# Backup MySQL hằng ngày, giữ KEEP bản gần nhất.
# Crontab (root):  15 3 * * * /opt/bot-trading/deploy/backup.sh >> /var/log/bot-trading-backup.log 2>&1
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/bot-trading}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/bot-trading}"
KEEP="${KEEP:-14}"

cd "$APP_DIR"
# Đọc mật khẩu MySQL từ .env (MYSQL_ROOT_PASSWORD) — không in ra log
MYSQL_ROOT_PASSWORD="$(grep -E '^MYSQL_ROOT_PASSWORD=' .env | cut -d= -f2- | tr -d '"')"
if [ -z "$MYSQL_ROOT_PASSWORD" ]; then
  echo "$(date -Is) Thiếu MYSQL_ROOT_PASSWORD trong .env" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
FILE="$BACKUP_DIR/bot_trading_$(date +%F_%H%M).sql.gz"

docker compose exec -T -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql \
  mysqldump -uroot --single-transaction --routines --triggers bot_trading | gzip > "$FILE.tmp"
mv "$FILE.tmp" "$FILE"
chmod 600 "$FILE"

# Xoá bản cũ, giữ KEEP bản mới nhất
ls -1t "$BACKUP_DIR"/bot_trading_*.sql.gz | tail -n +$((KEEP + 1)) | xargs -r rm -f
echo "$(date -Is) Backup OK: $FILE ($(du -h "$FILE" | cut -f1))"
