import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkStop, clampStake, computeLimits, inWindow, lossStreak, marketOutcome, nextDirection, nextStake, settlePnl, tradingDate,
  type OrderOutcome,
} from "../src/lib/strategy";

const W = (direction: "UP" | "DOWN" = "UP", amount = 10_000): OrderOutcome => ({ direction, amount, result: "WIN" });
const L = (direction: "UP" | "DOWN" = "UP", amount = 10_000): OrderOutcome => ({ direction, amount, result: "LOSS" });

test("lossStreak bỏ qua hoà/không rõ", () => {
  assert.equal(lossStreak([W(), L(), { direction: "UP", amount: 1, result: "DRAW" }, L()]), 2);
  assert.equal(lossStreak([L(), W()]), 0);
});

test("nextStake: cố định, %, martingale, anti, dãy", () => {
  assert.equal(nextStake("FIXED", { base: 12_345 }, [], 0), 12_000);
  assert.equal(nextStake("PERCENT_BALANCE", { percent: 1 }, [], 10_000_000), 100_000);
  assert.equal(nextStake("MARTINGALE", { base: 10_000, multiplier: 2 }, [W(), L(), L()], 0), 40_000);
  assert.equal(nextStake("MARTINGALE", { base: 10_000, multiplier: 2, maxSteps: 1 }, [L(), L(), L()], 0), 20_000);
  assert.equal(nextStake("MARTINGALE", { base: 10_000 }, [L(), L(), W()], 0), 10_000, "thắng thì về gốc");
  assert.equal(nextStake("ANTI_MARTINGALE", { base: 10_000, multiplier: 2 }, [W(), W()], 0), 40_000);
  assert.equal(nextStake("ANTI_MARTINGALE", { base: 10_000, multiplier: 2, maxSteps: 1 }, [W(), W(), W()], 0), 20_000);
  const seq = { sequence: [10_000, 20_000, 50_000] };
  assert.equal(nextStake("SEQUENCE", seq, [], 0), 10_000);
  assert.equal(nextStake("SEQUENCE", seq, [L(), L()], 0), 50_000);
  assert.equal(nextStake("SEQUENCE", seq, [L(), L(), L()], 0), 10_000, "hết dãy quay lại đầu");
});

test("marketOutcome suy ra hướng thị trường", () => {
  assert.equal(marketOutcome(W("DOWN")), "DOWN");
  assert.equal(marketOutcome(L("DOWN")), "UP");
});

test("nextDirection các chế độ", () => {
  assert.equal(nextDirection("FIXED", { fixed: "DOWN" }, []), "DOWN");
  assert.equal(nextDirection("FOLLOW_LAST", { initial: "DOWN" }, []), "DOWN");
  assert.equal(nextDirection("FOLLOW_LAST", {}, [L("UP")]), "DOWN", "thua lệnh UP → thị trường DOWN → theo DOWN");
  assert.equal(nextDirection("REVERSE_LAST", {}, [W("UP")]), "DOWN");
  assert.equal(nextDirection("PATTERN", { pattern: ["UP", "UP", "DOWN"] }, [W(), W()]), "DOWN");
  assert.equal(nextDirection("RANDOM", {}, [], () => 0.9), "DOWN");
  // 3 phiên thị trường cùng UP → đánh ngược
  assert.equal(nextDirection("RULE", { streak: 3 }, [W("UP"), W("UP"), L("DOWN")]), "DOWN");
  assert.equal(nextDirection("RULE", { streak: 3, streakAction: "follow" }, [W("UP"), W("UP"), W("UP")]), "UP");
  assert.equal(nextDirection("AI", {}, []), "AI");
});

test("computeLimits đổi % sang tiền theo số dư đầu phiên", () => {
  assert.deepEqual(
    computeLimits({ takeProfitType: "PERCENT", takeProfitValue: 2, stopLossType: "AMOUNT", stopLossValue: 300_000 }, 10_000_000),
    { target: 200_000, lossLimit: 300_000 },
  );
});

test("checkStop theo thứ tự ưu tiên", () => {
  const l = { target: 100_000, lossLimit: 200_000, maxConsecutiveLoss: 3, maxOrdersPerDay: 10 };
  assert.equal(checkStop({ pnl: 100_000, consecutiveLosses: 0, orderCount: 1 }, l), "TAKE_PROFIT");
  assert.equal(checkStop({ pnl: -200_000, consecutiveLosses: 0, orderCount: 1 }, l), "STOP_LOSS");
  assert.equal(checkStop({ pnl: -10, consecutiveLosses: 3, orderCount: 3 }, l), "MAX_CONSECUTIVE_LOSS");
  assert.equal(checkStop({ pnl: 0, consecutiveLosses: 0, orderCount: 10 }, l), "MAX_ORDERS");
  assert.equal(checkStop({ pnl: 99_999, consecutiveLosses: 2, orderCount: 9 }, l), null);
  assert.equal(checkStop({ pnl: 1e9, consecutiveLosses: 0, orderCount: 0 }, { ...l, target: 0 }), null, "target 0 = tắt");
});

test("clampStake áp trần, số dư, ngân sách, phần lỗ còn lại", () => {
  const base = { maxStake: 50_000, balance: 1_000_000, budgetLeft: 1_000_000, lossRoom: null, minStake: 1000 };
  assert.equal(clampStake(80_000, base), 50_000);
  assert.equal(clampStake(40_000, { ...base, budgetLeft: 30_000 }), 30_000);
  assert.equal(clampStake(40_000, { ...base, lossRoom: 15_000 }), 15_000, "không để 1 lệnh thua vượt cắt lỗ");
  assert.equal(clampStake(40_000, { ...base, budgetLeft: 500 }), null);
});

test("settlePnl", () => {
  assert.equal(settlePnl(20_000, "WIN", 95), 19_000);
  assert.equal(settlePnl(20_000, "LOSS", 95), -20_000);
  assert.equal(settlePnl(20_000, "DRAW", 95), 0);
});

test("tradingDate & inWindow theo múi giờ VN", () => {
  const t = new Date("2026-11-16T17:30:00Z"); // 00:30 ngày 17 giờ VN
  assert.equal(tradingDate(t, "Asia/Ho_Chi_Minh"), "2026-11-17");
  assert.equal(inWindow(t, "Asia/Ho_Chi_Minh", "09:00", "22:00"), false);
  assert.equal(inWindow(t, "Asia/Ho_Chi_Minh", "22:00", "02:00"), true, "khung qua đêm");
  assert.equal(inWindow(t, "Asia/Ho_Chi_Minh", null, null), true);
});
