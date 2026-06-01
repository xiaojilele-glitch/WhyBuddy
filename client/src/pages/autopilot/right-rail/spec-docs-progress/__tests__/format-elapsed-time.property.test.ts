/**
 * Property-based test: Elapsed time formatting
 *
 * **Property 5: Elapsed time formatting**
 * **Validates: Requirements 3.5**
 *
 * For any non-negative integer representing elapsed milliseconds,
 * `formatElapsedTime` SHALL produce a string in MM:SS format when total time
 * is under 60 minutes, or HH:MM:SS format when total time is 60 minutes or
 * more, where minutes and seconds are zero-padded to 2 digits.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { formatElapsedTime } from "../format-elapsed-time";

describe("Property 5: Elapsed time formatting", () => {
  it("produces MM:SS format when total time is under 60 minutes", () => {
    fc.assert(
      fc.property(
        // 0 to just under 60 minutes (3,599,999 ms)
        fc.integer({ min: 0, max: 3_599_999 }),
        (ms) => {
          const result = formatElapsedTime(ms);

          const totalSeconds = Math.floor(ms / 1000);
          const expectedMinutes = Math.floor(totalSeconds / 60);
          const expectedSeconds = totalSeconds % 60;
          const expectedSS = String(expectedSeconds).padStart(2, "0");

          // Format: M:SS or MM:SS (minutes not zero-padded in < 60 min mode)
          const expected = `${expectedMinutes}:${expectedSS}`;
          expect(result).toBe(expected);

          // Verify seconds are always zero-padded to 2 digits
          const parts = result.split(":");
          expect(parts).toHaveLength(2);
          expect(parts[1]).toHaveLength(2);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("produces HH:MM:SS format when total time is 60 minutes or more", () => {
    fc.assert(
      fc.property(
        // 60 minutes (3,600,000 ms) to a large value
        fc.integer({ min: 3_600_000, max: 360_000_000 }),
        (ms) => {
          const result = formatElapsedTime(ms);

          const totalSeconds = Math.floor(ms / 1000);
          const expectedHours = Math.floor(totalSeconds / 3600);
          const expectedMinutes = Math.floor((totalSeconds % 3600) / 60);
          const expectedSeconds = totalSeconds % 60;
          const expectedMM = String(expectedMinutes).padStart(2, "0");
          const expectedSS = String(expectedSeconds).padStart(2, "0");

          const expected = `${expectedHours}:${expectedMM}:${expectedSS}`;
          expect(result).toBe(expected);

          // Verify HH:MM:SS format with zero-padded minutes and seconds
          const parts = result.split(":");
          expect(parts).toHaveLength(3);
          expect(parts[1]).toHaveLength(2); // minutes zero-padded
          expect(parts[2]).toHaveLength(2); // seconds zero-padded
        }
      ),
      { numRuns: 100 }
    );
  });

  it("handles negative milliseconds by clamping to zero", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: -1 }),
        (ms) => {
          const result = formatElapsedTime(ms);
          // Negative values should clamp to 0 seconds → "0:00"
          expect(result).toBe("0:00");
        }
      ),
      { numRuns: 100 }
    );
  });
});
