/**
 * Feature: autopilot-image-rendering-and-visual-system, Property 6: ImageGalleryCache LRU 24-cap
 *
 * Validates: Requirements 9.3, 9.4
 *
 * Three property assertions over arbitrary sequences of `put` operations against
 * a fresh `ImageGalleryCache` backed by `fake-indexeddb`:
 *
 *  1. Size cap & evict-oldest — for any sequence of `put`s with monotonically
 *     increasing `storedAt`, `size()` is at most `IMAGE_GALLERY_CACHE_CAP`
 *     (= 24); whenever the sequence overflows, the surviving keys are exactly
 *     the last 24 puts (i.e. the entries with the largest `storedAt`), and any
 *     key evicted earlier in the sequence returns `null` on `get`.
 *  2. Put-then-get round-trip — for any single `put(entry)` followed by
 *     `get(entry.key)`, the returned entry is non-null and every field other
 *     than `storedAt` (which is touch-refreshed by `get`) equals the put
 *     entry's field. The `storedAt` of the returned entry is `>= entry.storedAt`.
 *  3. Never-put key returns `null` — for any key never inserted into a fresh
 *     cache, `get(key)` resolves to `null`.
 *
 * Each property runs with `fc.assert(prop, { numRuns: 100 })`.
 *
 * Each property iteration uses a unique `databaseName` so the IndexedDB store
 * and the cache instance's internal `dbPromise` are independent across runs.
 */

import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  IMAGE_GALLERY_CACHE_CAP,
  createImageGalleryCache,
  type ImageGalleryCacheEntry,
} from "../../../lib/autopilot/image-gallery-cache.js";

let dbCounter = 0;
function freshDatabaseName(): string {
  dbCounter += 1;
  return `image-gallery-cache-property-test-${process.pid}-${Date.now()}-${dbCounter}`;
}

interface PutInput {
  readonly key: string;
  readonly missionId: string;
  readonly nodeId: string;
  readonly version: number;
  readonly b64: string;
  readonly mimeType: string;
  readonly promptUsed: string;
  readonly generatedAt: string;
}

/**
 * Build a fast-check arbitrary that produces a list of `put` inputs with
 * unique keys, so the size-cap / evict-oldest property exercises strict
 * insertion ordering rather than upserts.
 *
 * `maxLength: 50` is intentionally chosen to span both below-cap (≤ 24) and
 * above-cap (> 24) regimes around `IMAGE_GALLERY_CACHE_CAP = 24`.
 */
function uniquePutSequenceArb(): fc.Arbitrary<readonly PutInput[]> {
  const sizeArb = fc.integer({ min: 0, max: 50 });
  return sizeArb.chain((n) =>
    fc.tuple(
      fc.array(fc.string({ maxLength: 32 }), { minLength: n, maxLength: n }),
      fc.array(fc.string({ maxLength: 32 }), { minLength: n, maxLength: n }),
      fc.array(fc.integer({ min: 1, max: 1_000_000 }), {
        minLength: n,
        maxLength: n,
      }),
      fc.array(fc.string({ maxLength: 32 }), { minLength: n, maxLength: n }),
    ).map(([missionIds, b64s, versions, prompts]) => {
      const out: PutInput[] = [];
      for (let i = 0; i < n; i += 1) {
        out.push({
          // Index-based keys guarantee uniqueness across the sequence.
          key: `entry-${i}`,
          missionId: missionIds[i] ?? `m-${i}`,
          nodeId: `node-${i}`,
          version: versions[i] ?? 1,
          b64: b64s[i] ?? "",
          mimeType: "image/png",
          promptUsed: prompts[i] ?? "",
          generatedAt: new Date(1_700_000_000_000 + i).toISOString(),
        });
      }
      return out;
    }),
  );
}

/**
 * Single-entry generator for the round-trip property — no uniqueness
 * constraints required since only one `put`/`get` is executed.
 */
function singleEntryArb(): fc.Arbitrary<PutInput> {
  return fc.record({
    key: fc.string({ minLength: 1, maxLength: 64 }),
    missionId: fc.string({ minLength: 1, maxLength: 32 }),
    nodeId: fc.string({ minLength: 1, maxLength: 32 }),
    version: fc.integer({ min: 1, max: 1_000_000 }),
    b64: fc.string({ maxLength: 64 }),
    mimeType: fc.constantFrom("image/png", "image/jpeg", "image/webp"),
    promptUsed: fc.string({ maxLength: 64 }),
    generatedAt: fc
      .integer({ min: 1_700_000_000_000, max: 1_800_000_000_000 })
      .map((ms) => new Date(ms).toISOString()),
  });
}

function entryFromInput(
  input: PutInput,
  storedAt: number,
): ImageGalleryCacheEntry {
  return {
    key: input.key,
    missionId: input.missionId,
    nodeId: input.nodeId,
    version: input.version,
    b64: input.b64,
    mimeType: input.mimeType,
    promptUsed: input.promptUsed,
    generatedAt: input.generatedAt,
    storedAt,
  };
}

describe("Feature: autopilot-image-rendering-and-visual-system, Property 6: ImageGalleryCache LRU 24-cap", () => {
  it("caps size at IMAGE_GALLERY_CACHE_CAP and evicts the entries with the smallest storedAt (Requirements 9.3, 9.4)", async () => {
    await fc.assert(
      fc.asyncProperty(uniquePutSequenceArb(), async (puts) => {
        // Strictly monotonic storedAt counter for puts. The injected `clock`
        // only fires on `get` (touch-refresh), so we drive put-side ordering
        // explicitly here. Pinning the clock to a value strictly greater than
        // any put storedAt makes touch-refresh on get() never collide with a
        // put storedAt, which keeps "smallest storedAt" deterministic.
        let storedAtCounter = 0;
        const dbName = freshDatabaseName();
        const cache = createImageGalleryCache({
          clock: () => storedAtCounter + 1_000_000,
          databaseName: dbName,
        });

        for (const input of puts) {
          storedAtCounter += 1;
          await cache.put(entryFromInput(input, storedAtCounter));
        }

        const size = await cache.size();
        const expectedSize = Math.min(puts.length, IMAGE_GALLERY_CACHE_CAP);
        expect(size).toBe(expectedSize);
        expect(size).toBeLessThanOrEqual(IMAGE_GALLERY_CACHE_CAP);

        const survivorStart = Math.max(
          0,
          puts.length - IMAGE_GALLERY_CACHE_CAP,
        );
        const survivors = puts.slice(survivorStart);
        const evicted = puts.slice(0, survivorStart);

        // Surviving keys (the last `min(n, 24)` puts) MUST be retrievable and
        // their core fields MUST match what was put (modulo storedAt, which is
        // touch-refreshed by get()).
        for (const input of survivors) {
          const got = await cache.get(input.key);
          expect(got).not.toBeNull();
          if (!got) return;
          expect(got.key).toBe(input.key);
          expect(got.missionId).toBe(input.missionId);
          expect(got.nodeId).toBe(input.nodeId);
          expect(got.version).toBe(input.version);
          expect(got.b64).toBe(input.b64);
          expect(got.mimeType).toBe(input.mimeType);
          expect(got.promptUsed).toBe(input.promptUsed);
          expect(got.generatedAt).toBe(input.generatedAt);
        }

        // Evicted keys (the earliest puts beyond the cap) MUST return null.
        for (const input of evicted) {
          const got = await cache.get(input.key);
          expect(got).toBeNull();
        }

        await cache.clear();
      }),
      { numRuns: 100 },
    );
  });

  it("returns a non-null entry whose non-storedAt fields equal the put entry on put-then-get (Requirement 9.3)", async () => {
    await fc.assert(
      fc.asyncProperty(singleEntryArb(), async (input) => {
        let tick = 0;
        const dbName = freshDatabaseName();
        const cache = createImageGalleryCache({
          clock: () => {
            tick += 1;
            return tick;
          },
          databaseName: dbName,
        });

        const putStoredAt = tick + 1;
        const entry = entryFromInput(input, putStoredAt);
        await cache.put(entry);

        const got = await cache.get(input.key);
        expect(got).not.toBeNull();
        if (!got) return;

        expect(got.key).toBe(entry.key);
        expect(got.missionId).toBe(entry.missionId);
        expect(got.nodeId).toBe(entry.nodeId);
        expect(got.version).toBe(entry.version);
        expect(got.b64).toBe(entry.b64);
        expect(got.mimeType).toBe(entry.mimeType);
        expect(got.promptUsed).toBe(entry.promptUsed);
        expect(got.generatedAt).toBe(entry.generatedAt);
        // storedAt is touch-refreshed by get() — must be >= the put's storedAt.
        expect(got.storedAt).toBeGreaterThanOrEqual(entry.storedAt);

        await cache.clear();
      }),
      { numRuns: 100 },
    );
  });

  it("returns null for any key never put into a fresh cache (Requirement 9.3)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 64 }),
        async (missingKey) => {
          const dbName = freshDatabaseName();
          const cache = createImageGalleryCache({ databaseName: dbName });
          const got = await cache.get(missingKey);
          expect(got).toBeNull();
          await cache.clear();
        },
      ),
      { numRuns: 100 },
    );
  });
});
