import { test } from "node:test";
import assert from "node:assert/strict";
import { byBot, csvCell, dailySeries, maxDrawdown, summarize, type RunRow } from "../src/lib/report";

const rows: RunRow[] = [
  { date: "2026-11-01", botId: "a", botName: "A", pnl: 100, orders: 4, wins: 3, losses: 1 },
  { date: "2026-11-01", botId: "b", botName: "B", pnl: -50, orders: 2, wins: 0, losses: 2 },
  { date: "2026-11-03", botId: "a", botName: "A", pnl: -200, orders: 5, wins: 1, losses: 4 },
];

test("dailySeries gộp theo ngày và điền ngày trống", () => {
  const d = dailySeries(rows, "2026-11-01", "2026-11-04");
  assert.deepEqual(d.map((x) => [x.date, x.pnl, x.cumulative]), [
    ["2026-11-01", 50, 50],
    ["2026-11-02", 0, 50],
    ["2026-11-03", -200, -150],
    ["2026-11-04", 0, -150],
  ]);
});

test("maxDrawdown tính từ đỉnh xuống đáy", () => {
  assert.equal(maxDrawdown([50, 50, -150, -150]), 200);
  assert.equal(maxDrawdown([10, 20, 30]), 0);
  assert.equal(maxDrawdown([-10, -30, 5, -20]), 30, "đỉnh ban đầu là 0");
});

test("summarize", () => {
  const s = summarize(dailySeries(rows, "2026-11-01", "2026-11-04"));
  assert.equal(s.total, -150);
  assert.equal(s.activeDays, 2);
  assert.equal(s.profitDays, 1);
  assert.equal(s.lossDays, 1);
  assert.equal(s.orders, 11);
  assert.equal(s.winRate, 4 / 11);
  assert.equal(s.best?.date, "2026-11-01");
  assert.equal(s.worst?.date, "2026-11-03");
});

test("byBot sắp theo lãi giảm dần", () => {
  assert.deepEqual(byBot(rows).map((b) => [b.botName, b.pnl, b.days]), [["B", -50, 1], ["A", -100, 2]]);
});

test("csvCell escape và chống CSV injection", () => {
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvCell("-200"), "-200");
  assert.equal(csvCell(null), "");
});
