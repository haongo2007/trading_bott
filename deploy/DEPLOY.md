# Deploy lên VPS (Ubuntu, Node.js + Nginx, không Docker)

Kiến trúc: **Nginx (HTTPS)** → `bot-web` (Next.js, mặc định cổng 3000) và `/live` → `bot-worker` (Playwright + WebSocket, cổng 3001).
MySQL cài trực tiếp bằng apt, chỉ nghe `127.0.0.1`. PM2 giữ 2 tiến trình luôn chạy và tự khởi động lại khi reboot.

> `docker-compose.yml` trong repo **chỉ dùng cho máy dev**. Trên server không cần Docker.

## 1. Chuẩn bị server

```bash
# Node.js: cần >= 20.19 (khuyến nghị 22 hoặc 24). Kiểm tra: node -v
# Nếu chưa có / quá cũ:
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs

sudo npm i -g pm2
sudo apt install -y git

# Tường lửa: chỉ mở SSH + HTTP/HTTPS. Cổng 3000, 3001, 3306 KHÔNG mở ra ngoài.
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
```

## 2. MySQL

```bash
sudo apt install -y mysql-server
sudo systemctl enable --now mysql
# Kiểm tra MySQL chỉ nghe nội bộ (phải thấy 127.0.0.1:3306, không phải 0.0.0.0):
sudo ss -ltnp | grep 3306
```

Tạo database và user riêng cho app (thay `MAT_KHAU_MANH` — tạo bằng `openssl rand -hex 24`, dùng hex để khỏi phải mã hoá URL):

```bash
sudo mysql <<'SQL'
CREATE DATABASE bot_trading CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'bot_trading'@'localhost' IDENTIFIED BY 'MAT_KHAU_MANH';
CREATE USER 'bot_trading'@'127.0.0.1' IDENTIFIED BY 'MAT_KHAU_MANH';
GRANT ALL PRIVILEGES ON bot_trading.* TO 'bot_trading'@'localhost';
GRANT ALL PRIVILEGES ON bot_trading.* TO 'bot_trading'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
```

> Server đã có sẵn MySQL/MariaDB khác? Chỉ cần chạy đoạn SQL trên (đổi cổng trong `DATABASE_URL` nếu không phải 3306).

## 3. Lấy code & cấu hình

```bash
sudo mkdir -p /opt/bot-trading && sudo chown $USER /opt/bot-trading
git clone https://github.com/haongo2007/trading_bott.git /opt/bot-trading
cd /opt/bot-trading
cp .env.example .env && chmod 600 .env
```

Sửa `.env` — **mọi giá trị bí mật phải tạo mới, không dùng lại của máy dev**:

| Biến | Giá trị |
|---|---|
| `DATABASE_URL` | `mysql://bot_trading:MAT_KHAU_MANH@127.0.0.1:3306/bot_trading?allowPublicKeyRetrieval=true` — **giữ nguyên `?allowPublicKeyRetrieval=true`**, thiếu nó app mất kết nối DB sau khi MySQL khởi động lại |
| `AUTH_SECRET` | `openssl rand -base64 33` |
| `ENCRYPTION_KEY` | `openssl rand -base64 32` — **backup riêng ở nơi an toàn**, mất là không giải mã được mật khẩu sàn |
| `WORKER_SECRET` | `openssl rand -base64 48` |
| `WORKER_PUBLIC_WS_URL` | `wss://bot.example.com/live` |
| `APP_ORIGIN` | `https://bot.example.com` |
| `WORKER_HTTP_URL` | `http://127.0.0.1:3001` (đổi nếu đổi `WORKER_PORT`) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | tài khoản admin đầu tiên (mật khẩu ≥ 12 ký tự) |
| `ANTHROPIC_API_KEY` | chỉ cần nếu dùng bot AI |
| `WORKER_PROXY_SERVER` | để trống trên VPS |

## 4. Cài đặt, build, chạy

```bash
cd /opt/bot-trading
npm ci
sudo npx playwright install-deps chromium   # thư viện hệ thống cho Chromium (cần sudo)
npx playwright install chromium             # tải Chromium cho user chạy app
npx prisma migrate deploy
npm run db:seed
npm run build

pm2 start ecosystem.config.cjs     # cổng 3000 bị app khác dùng? → WEB_PORT=3100 pm2 start ecosystem.config.cjs
pm2 save && pm2 startup            # chạy lệnh mà pm2 in ra để tự khởi động khi reboot
pm2 install pm2-logrotate          # xoay vòng log
```

Kiểm tra: `pm2 status`, `pm2 logs bot-worker --lines 50`, `curl -s 127.0.0.1:3001/health`, `curl -sI 127.0.0.1:3000/login`.

## 5A. Truy cập thẳng bằng IP:cổng (không Nginx)

Cần 2 cổng: **web** (dashboard) và **worker** (canvas "Trình duyệt trực tiếp" kết nối thẳng tới đây).
Kiểm tra cổng còn trống trước — không có dòng nào in ra là trống:

```bash
sudo ss -ltnp | grep -E ':3010 |:3011 '
```

Ví dụ web ở **3010**, worker ở **3011** (nếu 3001 đã có ứng dụng khác dùng). Sửa `.env`:

```bash
WEB_PORT=3010
WEB_HOST="0.0.0.0"
WORKER_PORT=3011
WORKER_HOST="0.0.0.0"
WORKER_HTTP_URL="http://127.0.0.1:3011"
WORKER_PUBLIC_WS_URL="ws://<IP-server>:3011/live"
APP_ORIGIN="http://<IP-server>:3010"
```

Mở 2 cổng trên tường lửa (và trên firewall/Security Group của nhà cung cấp VPS nếu có):

```bash
sudo ufw allow 3010/tcp
sudo ufw allow 3011/tcp
```

Khởi động lại PM2 để nhận cổng mới (PM2 tự đọc `WEB_PORT`/`WEB_HOST` từ `.env`, worker tự đọc `WORKER_*`):

```bash
pm2 delete bot-web bot-worker; pm2 start ecosystem.config.cjs && pm2 save
```

Mở `http://<IP-server>:3010`. Kiểm tra: `sudo ss -ltnp | grep -E ':3010 |:3011 '` phải thấy `0.0.0.0:3010` và `*:3011`.
Nếu cổng worker bị trùng, `pm2 logs bot-worker` sẽ báo *"Cổng … đã có ứng dụng khác dùng"* và worker dừng — không ảnh hưởng ứng dụng kia.

- `pm2 delete bot-web bot-worker` chỉ xoá 2 tiến trình của bot — **không dùng `pm2 delete all`** nếu server còn app khác chạy bằng PM2.
- Cổng worker bắt buộc mở ra ngoài vì trình duyệt của bạn kết nối thẳng tới worker để xem canvas (có token ký HMAC, hết hạn 2 phút). `/health` của worker chỉ trả lời cho chính server.
- ⚠️ Không có HTTPS: mật khẩu đăng nhập dashboard và hình ảnh canvas đi qua mạng **không mã hoá**. Nên chuyển sang mục 5B (tên miền + HTTPS) trước khi chạy với tài khoản sàn thật.

## 5B. Nginx + HTTPS (khuyến nghị)

Server đã có Nginx: chỉ cần thêm 1 site mới, không ảnh hưởng các site khác.

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/bot-trading
sudo sed -i 's/bot.example.com/<domain-của-bạn>/g' /etc/nginx/sites-available/bot-trading
# Nếu đổi WEB_PORT/WORKER_PORT: sửa 127.0.0.1:3000 / 127.0.0.1:3001 trong file cho khớp
sudo ln -s /etc/nginx/sites-available/bot-trading /etc/nginx/sites-enabled/
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d <domain-của-bạn>
sudo nginx -t && sudo systemctl reload nginx
```

## 6. Backup hằng ngày

`deploy/backup.sh` dùng `mysqldump` (có sẵn khi cài mysql-server), tự đọc thông tin kết nối từ `DATABASE_URL` trong `.env`.

```bash
chmod +x deploy/backup.sh
./deploy/backup.sh                 # chạy thử 1 lần → file ở ~/backups/bot-trading/
crontab -e
# thêm dòng (chạy 3h15 sáng mỗi ngày, giữ 14 bản):
15 3 * * * /opt/bot-trading/deploy/backup.sh >> /opt/bot-trading/backup.log 2>&1
```

Khôi phục: `gunzip -c ~/backups/bot-trading/<file>.sql.gz | sudo mysql bot_trading`

Nên chép thêm thư mục backup + `ENCRYPTION_KEY` sang nơi khác (máy khác / cloud) định kỳ.

## 7. Cập nhật phiên bản

```bash
cd /opt/bot-trading && git pull
npm ci && npx prisma migrate deploy && npm run build
pm2 reload bot-web
pm2 restart bot-worker   # bot đang chạy dở sẽ bị đánh dấu lỗi — nên cập nhật ngoài giờ bot chạy
```

## Lưu ý vận hành

- **Lịch chạy** do worker xử lý (kiểm tra mỗi 30 giây, theo múi giờ của từng bot). Worker tắt đúng giờ chạy → bật lại trong 30 phút vẫn chạy bù.
- **Dung lượng**: ảnh chụp ở `storage/` tự xoá sau số ngày cấu hình (Cài đặt → Lưu trữ, mặc định 14).
- **RAM**: mỗi phiên trình duyệt ~150–300MB. `MAX_BROWSER_CONTEXTS=8`, `MAX_BOT_RUNS=6` phù hợp 16GB.
- **Thông báo**: bật Telegram trong Cài đặt để biết ngay khi bot dừng, lỗi, hoặc có lệnh không rõ trạng thái.
