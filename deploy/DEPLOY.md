# Deploy lên VPS (Ubuntu 24.04, 16GB RAM)

Kiến trúc: **Nginx (HTTPS)** → `bot-web` (Next.js, cổng 3000) và `/live` → `bot-worker` (Playwright + WebSocket, cổng 3001).
MySQL chạy trong Docker, chỉ nghe `127.0.0.1`. PM2 giữ 2 tiến trình luôn chạy và tự khởi động lại khi reboot.

## 1. Cài đặt nền

```bash
sudo apt update && sudo apt upgrade -y
# Node.js 24
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs nginx git
# Docker (cho MySQL)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # đăng xuất/đăng nhập lại
# PM2
sudo npm i -g pm2
# Tường lửa: chỉ mở SSH + HTTP/HTTPS (3000, 3001, 3317 KHÔNG mở ra ngoài)
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
```

## 2. Lấy code & cấu hình

```bash
sudo mkdir -p /opt/bot-trading && sudo chown $USER /opt/bot-trading
git clone <repo> /opt/bot-trading && cd /opt/bot-trading
cp .env.example .env && chmod 600 .env
```

Sửa `.env` — **mỗi giá trị bí mật phải tạo mới, không dùng lại của máy dev**:

| Biến | Cách tạo / giá trị |
|---|---|
| `MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD` | `openssl rand -base64 24` (docker compose đọc từ .env) |
| `DATABASE_URL` | `mysql://bot:<MYSQL_PASSWORD>@127.0.0.1:3317/bot_trading` |
| `AUTH_SECRET` | `openssl rand -base64 33` |
| `ENCRYPTION_KEY` | `openssl rand -base64 32` — **backup riêng ở nơi an toàn**, mất là không giải mã được mật khẩu sàn |
| `WORKER_SECRET` | `openssl rand -base64 48` |
| `WORKER_PUBLIC_WS_URL` | `wss://bot.example.com/live` |
| `APP_ORIGIN` | `https://bot.example.com` |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | tài khoản admin đầu tiên (mật khẩu ≥ 12 ký tự) |
| `ANTHROPIC_API_KEY` | chỉ cần nếu dùng bot AI |

## 3. Database, build, chạy

```bash
docker compose up -d mysql
npm ci
npx playwright install --with-deps chromium
npx prisma migrate deploy
npm run db:seed
npm run build
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup   # chạy lệnh mà pm2 in ra để tự khởi động khi reboot
pm2 install pm2-logrotate # xoay vòng log
```

Kiểm tra: `pm2 status`, `pm2 logs bot-worker`, `curl -s 127.0.0.1:3001/health`.

## 4. Nginx + HTTPS

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/bot-trading
sudo sed -i 's/bot.example.com/<domain-của-bạn>/g' /etc/nginx/sites-available/bot-trading
sudo ln -s /etc/nginx/sites-available/bot-trading /etc/nginx/sites-enabled/
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d <domain-của-bạn>
sudo nginx -t && sudo systemctl reload nginx
```

## 5. Backup hằng ngày

```bash
chmod +x deploy/backup.sh
sudo crontab -e
# thêm dòng:
15 3 * * * /opt/bot-trading/deploy/backup.sh >> /var/log/bot-trading-backup.log 2>&1
```

Khôi phục: `gunzip -c <file>.sql.gz | docker compose exec -T mysql mysql -uroot -p<MYSQL_ROOT_PASSWORD> bot_trading`

## 6. Cập nhật phiên bản

```bash
cd /opt/bot-trading && git pull
npm ci && npx prisma migrate deploy && npm run build
pm2 reload bot-web
pm2 restart bot-worker   # worker sẽ đánh dấu bot đang chạy dở là lỗi — nên cập nhật ngoài giờ bot chạy
```

## Lưu ý vận hành

- **Lịch chạy** do worker xử lý (kiểm tra mỗi 30 giây, theo múi giờ của từng bot). Worker tắt đúng giờ chạy → bật lại trong 30 phút vẫn chạy bù.
- **Dung lượng**: ảnh chụp ở `storage/` tự xoá sau số ngày cấu hình (Cài đặt → Lưu trữ, mặc định 14).
- **RAM**: mỗi bot/phiên trình duyệt ~150–300MB. `MAX_BROWSER_CONTEXTS=8`, `MAX_BOT_RUNS=6` phù hợp 16GB.
- **Thông báo**: bật Telegram trong Cài đặt để biết ngay khi bot dừng, lỗi, hoặc có lệnh không rõ trạng thái.
