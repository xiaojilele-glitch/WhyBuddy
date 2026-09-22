import test from "node:test";
import assert from "node:assert/strict";
import { increment } from "../src/counter.mjs";

test("successive button actions advance the displayed count", () => {
  assert.equal(increment(0), 1);
  assert.equal(increment(increment(0)), 2);
});

test("invalid or overflowing state cannot silently produce an inaccurate count", () => {
  for (const value of [NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => increment(value), RangeError);
  }
});
