import { describe, it, expect } from "vitest";
import {
  MAIN_ARTIFACT_KIND_PRIORITY,
  pickMainArtifactByKind,
} from "../whybuddy-main-artifact.js";

describe("pickMainArtifactByKind (S6-1)", () => {
  it("follows full kind priority, not challenge-button whitelist", () => {
    expect(MAIN_ARTIFACT_KIND_PRIORITY).toEqual([
      "report",
      "synthesis",
      "risk",
      "route_options",
      "spec_tree",
      "doc",
      "preview",
      "clarification",
      "evidence",
      "decision",
    ]);

    const artifacts = [
      { id: "d1", kind: "decision" },
      { id: "c1", kind: "clarification" },
      { id: "r1", kind: "route_options" },
      { id: "s1", kind: "synthesis" },
    ];
    expect(pickMainArtifactByKind(artifacts)?.id).toBe("s1");
  });
});