import assert from "node:assert/strict";
import { test } from "node:test";
import { duration, formatFee, formatUsdc, parseUsdc } from "../lib/format";

test("USDC amounts parse and format exactly, without floats", () => {
  assert.equal(parseUsdc("12.5"), 12_500_000n);
  assert.equal(parseUsdc("0.000001"), 1n);
  assert.equal(parseUsdc("1,000"), 1_000_000_000n);
  assert.throws(() => parseUsdc("0.0000001"), /six decimal/);
  assert.throws(() => parseUsdc("abc"));
  assert.equal(formatUsdc(12_500_000n), "12.50");
  assert.equal(formatUsdc(1_234_567_890_000n), "1,234,567.89");
  assert.equal(formatUsdc(1n, 6), "0.000001");
  assert.equal(formatUsdc(100_000n, 6), "0.10");
});

test("network fees read in dollars from native USDC (18 decimals)", () => {
  // 150,000 gas at 21 gwei, paid in USDC
  assert.equal(formatFee(150_000n * 21_000_000_000n), "$0.0032");
  assert.equal(formatFee(0n), "<$0.000001");
});

test("durations use the largest unit that fits", () => {
  assert.equal(duration(3600), "1 hour");
  assert.equal(duration(172_800), "2 days");
  assert.equal(duration(59), "59 seconds");
});
