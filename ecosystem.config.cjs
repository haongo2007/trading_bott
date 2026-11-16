// PM2 — chạy dashboard (Next.js) và worker (Playwright) trên VPS.
//   pm2 start ecosystem.config.cjs && pm2 save
// Đổi cổng nếu server đã có app khác dùng: WEB_PORT=3100 pm2 start ecosystem.config.cjs
// (cổng worker đặt bằng WORKER_PORT trong .env). Nhớ sửa proxy_pass trong Nginx tương ứng.
const WEB_PORT = process.env.WEB_PORT || 3000;

module.exports = {
  apps: [
    {
      name: "bot-web",
      script: "node_modules/next/dist/bin/next",
      args: `start -p ${WEB_PORT} -H 127.0.0.1`,
      env: { NODE_ENV: "production" },
      max_memory_restart: "1G",
      time: true,
    },
    {
      name: "bot-worker",
      script: "node_modules/.bin/tsx",
      args: "worker/index.ts",
      env: { NODE_ENV: "production" },
      // Cho worker thời gian đóng trình duyệt & đánh dấu lệnh dở dang trước khi bị kill
      kill_timeout: 30_000,
      max_memory_restart: "6G",
      // Không tự restart dồn dập nếu lỗi cấu hình (VD thiếu DATABASE_URL)
      exp_backoff_restart_delay: 2000,
      time: true,
    },
  ],
};
