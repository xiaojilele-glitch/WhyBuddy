import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchOrchestratePlan } from "../whybuddy-orchestrator";

describe("fetchOrchestratePlan (R1-B6)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null on timeout (local_heuristic path in caller)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        const onAbort = () => reject(new DOMException("aborted", "AbortError"));
        if (signal?.aborted) {
          onAbort();
          return;
        }
        signal?.addEventListener("abort", onAbort, { once: true });
      }) as any;
    });

    const t0 = Date.now();
    const result = await fetchOrchestratePlan(
      {
        state: { sessionId: "s", goal: { text: "x" } } as any,
        turnId: "t-timeout",
        userText: "对比运维成本",
      },
      { timeoutMs: 50 }
    );
    expect(result).toBeNull();
    expect(Date.now() - t0).toBeLessThan(500);
  });
});