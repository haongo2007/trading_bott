# Bot Trading

Dashboard quản lý bot giao dịch tự động qua trình duyệt (Next.js 16 · Prisma 7 · MySQL · Auth.js v5).

## Chạy local (máy dev — MySQL chạy bằng Docker)

> Trên server không cần Docker: xem [deploy/DEPLOY.md](deploy/DEPLOY.md) (Node.js + Nginx + MySQL cài bằng apt).

```bash
cp .env.example .env          # điền AUTH_SECRET, ENCRYPTION_KEY, ADMIN_PASSWORD
npm install
npm run db:up                 # MySQL 8.4 trong Docker, cổng 3317
# Lần đầu (dev): cho user `bot` quyền tạo shadow DB của Prisma Migrate
docker compose exec mysql mysql -uroot -prootpass -e "GRANT ALL PRIVILEGES ON *.* TO 'bot'@'%'; FLUSH PRIVILEGES;"
npm run db:migrate
npm run db:seed               # tạo admin từ ADMIN_EMAIL / ADMIN_PASSWORD
npm run dev
```

Production: dùng `npx prisma migrate deploy` (không cần shadow DB / quyền GRANT ALL).

> ⚠️ `ENCRYPTION_KEY` dùng để mã hoá thông tin đăng nhập sàn. Mất khoá = không giải mã được dữ liệu đã lưu.

## Worker (Playwright)

Tiến trình riêng, chạy song song với Next.js:

```bash
npx playwright install chromium   # lần đầu (trên VPS Ubuntu: npx playwright install --with-deps chromium)
npm run worker                    # hoặc npm run worker:dev (tự reload khi sửa code)
```

- `GET http://127.0.0.1:3001/health` — trạng thái worker
- `ws://…:3001/live?token=…` — trình duyệt trực tiếp (token HMAC 2 phút do dashboard cấp)
- Nhận lệnh `TEST_LOGIN` từ bảng `Command` (claim nguyên tử, khoá theo tài khoản)
- Ảnh chụp khi lỗi: `storage/screenshots/`

## Website bị nhà mạng chặn ở máy local

Trình duyệt mở website sàn chạy **trong worker**. Trên VPS, website được truy cập bằng mạng của VPS — máy bạn chỉ nhận hình ảnh qua canvas, nên chặn ở mạng nhà không ảnh hưởng.

Khi phát triển ở local (worker chạy trên máy bạn), cho Chromium đi qua VPS bằng tunnel SSH:

```bash
ssh -N -D 1080 user@your-vps                     # giữ terminal này mở
# .env: WORKER_PROXY_SERVER="socks5://127.0.0.1:1080"  rồi khởi động lại worker
```

Log worker sẽ ghi `Đã khởi động Chromium … (qua proxy socks5://127.0.0.1:1080)`. Với SOCKS5, tên miền được phân giải ở VPS nên tránh được cả chặn bằng DNS.

## Sàn giả lập (để test, không dùng tiền thật)

```bash
npm run fake:exchange   # http://localhost:4100 — demo / demo123, phiên 30 giây
```

Tạo tài khoản sàn với: URL đăng nhập `http://localhost:4100/login`, URL đặt lệnh `http://localhost:4100/trade`,
selector `#username`, `#password`, `button[type=submit]`, dấu hiệu đăng nhập `.user-avatar`, số dư `#balance`.

## AI dự đoán hướng (tuỳ chọn)

Đặt `ANTHROPIC_API_KEY` trong `.env` rồi khởi động lại worker. Model mặc định `claude-opus-5-5` (đổi được trong cài đặt bot). Thiếu khoá → bot AI dừng an toàn, không đặt lệnh.

## Test

```bash
npm test   # unit test: số dư, token worker, flow, chiến lược, lịch, báo cáo
```

## Production

Hướng dẫn đầy đủ (không Docker): [deploy/DEPLOY.md](deploy/DEPLOY.md). Gợi ý Nginx cho WebSocket:

```nginx
location /live {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
}
```

Đặt `WORKER_PUBLIC_WS_URL=wss://your-domain/live` và `APP_ORIGIN=https://your-domain`. Worker chỉ listen `127.0.0.1`.

## Lộ trình
1. ✅ Nền tảng: auth, schema, quản lý tài khoản sàn (mã hoá AES-256-GCM)
2. ✅ Worker Playwright + trình duyệt trực tiếp trên canvas (chọn phần tử, ghi thao tác, lưu phiên, kiểm tra đăng nhập)
3. ✅ Flow builder (React Flow): 10 loại khối, biến `{{...}}`, điều kiện/vòng lặp, tạo từ bước đã ghi, chạy thử trên worker (khối “đặt lệnh” chỉ tô sáng), log + ảnh từng bước, nút dừng
4. ✅ Bot engine: 5 cách tính tiền, 7 cách chọn hướng (gồm AI Claude), chốt lời/cắt lỗ ngày, thua liên tiếp, ngân sách, khung giờ, chạy thử giả lập, dừng / dừng khẩn cấp
5. ✅ Lịch tự chạy (cron theo múi giờ, chạy bù 30 phút, chống chạy trùng), Telegram, trang Tổng quan, báo cáo + CSV, tự dọn ảnh cũ, deploy PM2 + Nginx + backup — xem [deploy/DEPLOY.md](deploy/DEPLOY.md)
