import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCron, describeCron, dueRun, nextRuns, parseSimpleCron, validateCron } from "../src/lib/schedule";

const TZ = "Asia/Ho_Chi_Minh";

test("buildCron / parseSimpleCron hai chiều", () => {
  assert.equal(buildCron("09:30", [1, 2, 3, 4, 5]), "30 9 * * 1,2,3,4,5");
  assert.equal(buildCron("21:05", [0, 1, 2, 3, 4, 5, 6]), "5 21 * * *");
  assert.deepEqual(parseSimpleCron("30 9 * * 1,2,3,4,5"), { time: "09:30", days: [1, 2, 3, 4, 5] });
  assert.equal(parseSimpleCron("*/5 * * * *"), null);
  assert.throws(() => buildCron("25:00", [1]));
  assert.throws(() => buildCron("09:00", []));
});

test("validateCron", () => {
  assert.equal(validateCron("0 9 * * *", TZ), null);
  assert.ok(validateCron("0 9 * *", TZ));
  assert.ok(validateCron("99 9 * * *", TZ));
});

test("nextRuns theo giờ Việt Nam", () => {
  const from = new Date("2026-11-16T01:00:00Z"); // 08:00 giờ VN, thứ Hai
  const [a, b] = nextRuns("0 9 * * *", TZ, from, 2);
  assert.equal(a.toISOString(), "2026-11-16T02:00:00.000Z"); // 09:00 VN
  assert.equal(b.toISOString(), "2026-11-17T02:00:00.000Z");
});

test("dueRun: đúng giờ, đã chạy, quá cửa sổ bù", () => {
  const slot = new Date("2026-11-16T02:00:00Z"); // 09:00 VN
  const now = new Date("2026-11-16T02:00:20Z");
  assert.equal(dueRun("0 9 * * *", TZ, now, null)?.toISOString(), slot.toISOString());
  assert.equal(dueRun("0 9 * * *", TZ, now, slot), null, "đã xử lý mốc này");
  assert.equal(dueRun("0 9 * * *", TZ, new Date("2026-11-16T02:20:00Z"), null)?.toISOString(), slot.toISOString(), "bù trong 30 phút");
  assert.equal(dueRun("0 9 * * *", TZ, new Date("2026-11-16T02:45:00Z"), null), null, "quá cửa sổ bù");
  assert.equal(dueRun("0 9 * * 0", TZ, now, null), null, "không phải ngày chạy (CN)");
});

test("describeCron", () => {
  assert.equal(describeCron("0 9 * * *"), "Hằng ngày lúc 09:00");
  assert.equal(describeCron("30 8 * * 1,2,3,4,5"), "T2–T6 lúc 08:30");
  assert.equal(describeCron("0 20 * * 0,6"), "T7, CN lúc 20:00");
  assert.equal(describeCron("*/10 * * * *"), "Cron: */10 * * * *");
});
