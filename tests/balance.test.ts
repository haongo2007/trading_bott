import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBalance } from "../src/lib/balance";

const cases: [string | null, number | null][] = [
  ["12.500.000 ₫", 12500000],
  ["12,500,000 VND", 12500000],
  ["Số dư: 12 500 000 đ", 12500000],
  ["$1,234.56", 1234.56],
  ["1.234,56 €", 1234.56],
  ["12.500", 12500],
  ["0.5", 0.5],
  ["12.50", 12.5],
  ["-250.000", -250000],
  ["1000", 1000],
  ["100.", 100],
  ["không có số", null],
  ["", null],
  [null, null],
];

for (const [input, expected] of cases) {
  test(`parseBalance(${JSON.stringify(input)}) = ${expected}`, () => {
    assert.equal(parseBalance(input), expected);
  });
}
