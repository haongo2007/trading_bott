// Sàn giao dịch GIẢ LẬP để phát triển & test bot — không liên quan tiền thật.
// Chạy: npm run fake:exchange  →  http://localhost:4100  (tài khoản: demo / demo123)
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

const PORT = Number(process.env.FAKE_EXCHANGE_PORT ?? 4100);
const USER = process.env.FAKE_EXCHANGE_USER ?? "demo";
const PASS = process.env.FAKE_EXCHANGE_PASS ?? "demo123";
const ROUND_SEC = Number(process.env.FAKE_EXCHANGE_ROUND_SEC ?? 30);
const PAYOUT = 0.95;

/** @type {Map<string, {balance:number, orders:{round:number,dir:string,amount:number,result?:string,pnl?:number}[]}>} */
const sessions = new Map();
const history = []; // kết quả các phiên: "UP" | "DOWN"
let round = 1;
let roundEndsAt = Date.now() + ROUND_SEC * 1000;

setInterval(() => {
  if (Date.now() < roundEndsAt) return;
  const result = Math.random() < 0.5 ? "UP" : "DOWN";
  history.unshift(result);
  history.length = Math.min(history.length, 50);
  for (const s of sessions.values()) {
    for (const o of s.orders) {
      if (o.round !== round || o.result) continue;
      o.result = o.dir === result ? "WIN" : "LOSS";
      o.pnl = o.result === "WIN" ? Math.round(o.amount * PAYOUT) : -o.amount;
      if (o.result === "WIN") s.balance += o.amount + o.pnl;
    }
  }
  round += 1;
  roundEndsAt = Date.now() + ROUND_SEC * 1000;
}, 250);

const fmt = (n) => n.toLocaleString("vi-VN");
const cookie = (req) => Object.fromEntries((req.headers.cookie ?? "").split(";").map((c) => c.trim().split("=")));
const page = (title, body) => `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${title}</title>
<style>
body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;margin:0}
.wrap{max-width:900px;margin:0 auto;padding:24px}
.card{background:#1e293b;border-radius:12px;padding:24px;margin-bottom:16px}
input{padding:10px;border-radius:8px;border:1px solid #475569;background:#0f172a;color:#fff;width:100%;box-sizing:border-box;margin:6px 0 14px}
button{padding:12px 20px;border:0;border-radius:8px;font-weight:700;cursor:pointer;font-size:16px}
.primary{background:#3b82f6;color:#fff;width:100%}
.up{background:#16a34a;color:#fff}.down{background:#dc2626;color:#fff}
header{display:flex;justify-content:space-between;align-items:center;padding:16px 24px;background:#1e293b}
.user-avatar{background:#334155;border-radius:999px;padding:6px 14px}
.balance-amount{font-size:22px;font-weight:800;color:#facc15}
.dots span{display:inline-block;width:18px;height:18px;border-radius:50%;margin:2px}
.err{color:#f87171}
</style></head><body>${body}</body></html>`;

function loginPage(error = "") {
  return page("Đăng nhập — Fake Exchange", `<div class="wrap" style="max-width:380px;margin-top:80px">
<div class="card"><h2>Fake Exchange</h2>
<form method="post" action="/login">
<label>Tên đăng nhập<input id="username" name="username" autocomplete="off"></label>
<label>Mật khẩu<input id="password" name="password" type="password"></label>
${error ? `<p class="err">${error}</p>` : ""}
<button class="primary" type="submit">Đăng nhập</button></form></div></div>`);
}

function tradePage(s) {
  return page("Giao dịch — Fake Exchange", `<header><b>Fake Exchange</b>
<div>Số dư: <span class="balance-amount" id="balance">${fmt(s.balance)} ₫</span></div>
<div><span class="user-avatar">${USER}</span> <a href="/logout" style="color:#94a3b8">Đăng xuất</a></div></header>
<div class="wrap">
<div class="card"><div>Phiên <b id="round">#${round}</b> — còn <b id="countdown">--</b>s</div>
<div class="dots" id="history" style="margin-top:12px"></div></div>
<div class="card"><label>Số tiền đặt<input id="amount" type="number" value="10000" min="1000" step="1000"></label>
<div style="display:flex;gap:12px"><button class="up" id="btn-up">▲ TĂNG</button><button class="down" id="btn-down">▼ GIẢM</button></div>
<p id="msg"></p></div>
<div class="card"><b>Lệnh gần đây</b><table id="orders" style="width:100%;margin-top:8px"></table></div></div>
<script>
const $=id=>document.getElementById(id);
async function order(dir){const r=await fetch('/api/order',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({dir,amount:Number($('amount').value)})});const j=await r.json();$('msg').textContent=j.message;$('msg').className=r.ok?'':'err';refresh();}
$('btn-up').onclick=()=>order('UP');$('btn-down').onclick=()=>order('DOWN');
async function refresh(){const j=await (await fetch('/api/state')).json();if(!j.ok){location.href='/login';return;}
$('balance').textContent=j.balance.toLocaleString('vi-VN')+' ₫';$('round').textContent='#'+j.round;$('countdown').textContent=j.secondsLeft;
$('history').innerHTML=j.history.map(h=>'<span title="'+h+'" class="result-'+h.toLowerCase()+'" style="background:'+(h==='UP'?'#16a34a':'#dc2626')+'"></span>').join('');
$('orders').innerHTML=j.orders.map(o=>'<tr class="order-row"><td>#'+o.round+'</td><td>'+o.dir+'</td><td>'+o.amount.toLocaleString('vi-VN')+'</td><td class="order-result">'+(o.result??'Chờ')+'</td><td>'+(o.pnl??'')+'</td></tr>').join('');}
refresh();setInterval(refresh,1000);
</script>`);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const sid = cookie(req).sid;
  const s = sid ? sessions.get(sid) : undefined;
  const send = (code, body, headers = {}) => {
    res.writeHead(code, { "content-type": "text/html; charset=utf-8", ...headers });
    res.end(body);
  };
  const json = (code, obj) => send(code, JSON.stringify(obj), { "content-type": "application/json" });
  const readBody = async () => {
    let b = "";
    for await (const c of req) b += c;
    return b;
  };

  if (url.pathname === "/" ) return send(302, "", { location: s ? "/trade" : "/login" });
  if (url.pathname === "/login" && req.method === "GET") return send(200, loginPage());
  if (url.pathname === "/login" && req.method === "POST") {
    const form = new URLSearchParams(await readBody());
    await new Promise((r) => setTimeout(r, 400)); // giả lập độ trễ
    if (form.get("username") !== USER || form.get("password") !== PASS) return send(401, loginPage("Sai tên đăng nhập hoặc mật khẩu"));
    const id = randomBytes(16).toString("hex");
    sessions.set(id, { balance: 10_000_000, orders: [] });
    return send(302, "", { location: "/trade", "set-cookie": `sid=${id}; HttpOnly; Path=/; SameSite=Lax` });
  }
  if (url.pathname === "/logout") {
    if (sid) sessions.delete(sid);
    return send(302, "", { location: "/login", "set-cookie": "sid=; Path=/; Max-Age=0" });
  }
  if (url.pathname === "/trade") return s ? send(200, tradePage(s)) : send(302, "", { location: "/login" });
  if (url.pathname === "/api/state") {
    if (!s) return json(401, { ok: false });
    return json(200, {
      ok: true, balance: s.balance, round, secondsLeft: Math.max(0, Math.ceil((roundEndsAt - Date.now()) / 1000)),
      history: history.slice(0, 20), orders: s.orders.slice(-10).reverse(),
    });
  }
  if (url.pathname === "/api/order" && req.method === "POST") {
    if (!s) return json(401, { ok: false, message: "Chưa đăng nhập" });
    const { dir, amount } = JSON.parse((await readBody()) || "{}");
    if (!["UP", "DOWN"].includes(dir) || !Number.isFinite(amount) || amount < 1000) return json(400, { message: "Lệnh không hợp lệ" });
    if (amount > s.balance) return json(400, { message: "Số dư không đủ" });
    if (s.orders.some((o) => o.round === round)) return json(400, { message: "Mỗi phiên chỉ đặt 1 lệnh" });
    s.balance -= amount;
    s.orders.push({ round, dir, amount });
    return json(200, { message: `Đã đặt ${dir} ${fmt(amount)} ₫ cho phiên #${round}` });
  }
  send(404, "Not found");
});

server.listen(PORT, "127.0.0.1", () => console.log(`Fake exchange: http://localhost:${PORT}  (${USER} / ${PASS}, phiên ${ROUND_SEC}s)`));
