#!/usr/bin/env bash
# Backup MySQL (cài trực tiếp trên máy, không Docker) hằng ngày, giữ KEEP bản gần nhất.
# Đọc thông tin kết nối từ DATABASE_URL trong .env — không cần lưu mật khẩu ở chỗ khác.
# Crontab (user chạy app):  15 3 * * * /opt/bot-trading/deploy/backup.sh >> /opt/bot-trading/backup.log 2>&1
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/bot-trading}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/bot-trading}"
KEEP="${KEEP:-14}"

URL="$(grep -E '^DATABASE_URL=' "$APP_DIR/.env" | head -1 | cut -d= -f2- | tr -d '"')"
# mysql://user:pass@host:port/db?params
if [[ ! "$URL" =~ ^mysql://([^:]+):([^@]*)@([^:/]+):?([0-9]*)/([^?]+) ]]; then
  echo "$(date "+%Y-%m-%dT%H:%M:%S") Không đọc được DATABASE_URL trong $APP_DIR/.env" >&2
  exit 1
fi
DB_USER="${BASH_REMATCH[1]}"
DB_PASS="$(printf '%b' "${BASH_REMATCH[2]//%/\\x}")"   # giải mã %40 → @ ...
DB_HOST="${BASH_REMATCH[3]}"
DB_PORT="${BASH_REMATCH[4]:-3306}"
DB_NAME="${BASH_REMATCH[5]}"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
FILE="$BACKUP_DIR/${DB_NAME}_$(date +%F_%H%M).sql.gz"

# MYSQL_PWD: không lộ mật khẩu trong danh sách tiến trình (ps)
# --no-tablespaces: user ứng dụng không có quyền PROCESS
MYSQL_PWD="$DB_PASS" mysqldump -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" \
  --single-transaction --no-tablespaces --default-character-set=utf8mb4 "$DB_NAME" | gzip > "$FILE.tmp"
mv "$FILE.tmp" "$FILE"
chmod 600 "$FILE"

ls -1t "$BACKUP_DIR"/"${DB_NAME}"_*.sql.gz | tail -n +$((KEEP + 1)) | xargs -r rm -f
echo "$(date "+%Y-%m-%dT%H:%M:%S") Backup OK: $FILE ($(du -h "$FILE" | cut -f1))"
