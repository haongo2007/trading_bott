// PM2 — chạy dashboard (Next.js) và worker (Playwright) trên VPS.
//   pm2 start ecosystem.config.cjs && pm2 save
//
// Cổng & địa chỉ nghe của web đọc từ .env:
//   WEB_PORT=3010          (mặc định 3000)
//   WEB_HOST=127.0.0.1     chỉ nhận kết nối nội bộ — dùng khi có Nginx phía trước (mặc định)
//   WEB_HOST=0.0.0.0       truy cập thẳng http://<IP>:<WEB_PORT> (không Nginx)
// Worker: WORKER_HOST / WORKER_PORT trong .env (worker tự đọc).
// Sau khi đổi các biến này: pm2 delete bot-web bot-worker; pm2 start ecosystem.config.cjs && pm2 save
// eslint-disable-next-line @typescript-eslint/no-require-imports -- file CommonJS bắt buộc cho PM2
require("dotenv").config({ path: `${__dirname}/.env`, quiet: true });

const WEB_PORT = process.env.WEB_PORT || 3000;
const WEB_HOST = process.env.WEB_HOST || "127.0.0.1";

module.exports = {
  apps: [
    {
      name: "bot-web",
      script: "node_modules/next/dist/bin/next",
      args: `start -p ${WEB_PORT} -H ${WEB_HOST}`,
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
