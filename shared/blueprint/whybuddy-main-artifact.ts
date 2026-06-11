/** S6-1: mainArtifact kind priority (full catalog, not challenge-button whitelist). */
export const MAIN_ARTIFACT_KIND_PRIORITY = [
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
] as const;

export type MainArtifactKind = (typeof MAIN_ARTIFACT_KIND_PRIORITY)[number];

export function pickMainArtifactByKind<T extends { kind?: string }>(
  artifacts: T[]
): T | undefined {
  for (const kind of MAIN_ARTIFACT_KIND_PRIORITY) {
    const art = artifacts.find((a) => a.kind === kind);
    if (art) return art;
  }
  return undefined;
}