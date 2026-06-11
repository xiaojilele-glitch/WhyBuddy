import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchOrchestratePlan } from "../whybuddy-orchestrator";

describe("fetchOrchestratePlan (R1-B6)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves LLM convergence signal with empty selected (F0.1 / task 2.3)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        selected: [],
        rationale: "coverage sufficient",
        source: "llm",
        converged: true,
      }),
    } as Response);

    const result = await fetchOrchestratePlan({
      state: { sessionId: "s", goal: { text: "x" } } as any,
      turnId: "t-conv",
      userText: "可以收尾了",
    });
    expect(result).not.toBeNull();
    expect(result?.source).toBe("llm");
    expect(result?.converged).toBe(true);
    expect(result?.selected).toEqual([]);
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