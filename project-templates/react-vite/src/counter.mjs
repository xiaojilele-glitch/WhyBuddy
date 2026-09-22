/** @param {number} value */
export function increment(value) {
  if (!Number.isSafeInteger(value) || value >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError("Count must be a safe integer below its maximum");
  }
  return value + 1;
}
