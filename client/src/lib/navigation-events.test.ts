import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  OFFICE_RUNTIME_EVIDENCE_EVENT,
  createOfficeRuntimeEvidenceEvent,
  dispatchOfficeRuntimeEvidenceEvent,
} from "./navigation-events";

describe("navigation runtime evidence events", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a shared runtime evidence event with normalized detail", () => {
    const event = createOfficeRuntimeEvidenceEvent("artifacts", "mission-42");

    expect(event.type).toBe(OFFICE_RUNTIME_EVIDENCE_EVENT);
    expect(event.detail).toEqual({
      tab: "artifacts",
      missionId: "mission-42",
    });
  });

  it("normalizes missing mission ids to null for shared runtime evidence events", () => {
    const event = createOfficeRuntimeEvidenceEvent("runtime");

    expect(event.detail).toEqual({
      tab: "runtime",
      missionId: null,
    });
  });

  it("dispatches the shared runtime evidence event through window when available", () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });

    dispatchOfficeRuntimeEvidenceEvent("logs", "mission-7");

    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    const dispatchedEvent = dispatchEvent.mock.calls[0]?.[0];
    expect(dispatchedEvent).toBeInstanceOf(CustomEvent);
    expect(dispatchedEvent.type).toBe(OFFICE_RUNTIME_EVIDENCE_EVENT);
    expect(dispatchedEvent.detail).toEqual({
      tab: "logs",
      missionId: "mission-7",
    });
  });

  it("does not attempt to dispatch runtime evidence events without window", () => {
    vi.stubGlobal("window", undefined);

    expect(() =>
      dispatchOfficeRuntimeEvidenceEvent("runtime", "mission-9")
    ).not.toThrow();
  });
});
