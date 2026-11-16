import { test } from "node:test";
import assert from "node:assert/strict";
import { signBrowserToken, verifyBrowserToken } from "../src/lib/worker-token";

process.env.WORKER_SECRET = "test-secret-test-secret-test-secret-123";
const payload = { accountId: "acc_1", userId: "user_1" };

test("token hợp lệ được chấp nhận", () => {
  const t = signBrowserToken(payload, 60);
  assert.deepEqual({ ...verifyBrowserToken(t), exp: 0 }, { ...payload, exp: 0 });
});

test("token hết hạn bị từ chối", () => {
  const t = signBrowserToken(payload, 60, Date.now() - 120_000);
  assert.equal(verifyBrowserToken(t), null);
});

test("token bị sửa payload bị từ chối", () => {
  const t = signBrowserToken(payload, 60);
  const [, sig] = t.split(".");
  const forged = Buffer.from(JSON.stringify({ ...payload, accountId: "acc_2", exp: 9999999999 })).toString("base64url");
  assert.equal(verifyBrowserToken(`${forged}.${sig}`), null);
});

test("token ký bằng secret khác bị từ chối", () => {
  const t = signBrowserToken(payload, 60);
  process.env.WORKER_SECRET = "another-secret-another-secret-another-1";
  assert.equal(verifyBrowserToken(t), null);
  process.env.WORKER_SECRET = "test-secret-test-secret-test-secret-123";
});

test("chuỗi rác bị từ chối", () => {
  assert.equal(verifyBrowserToken("abc"), null);
  assert.equal(verifyBrowserToken("a.b"), null);
});
