import { BlueprintRuntimeAgents } from "./BlueprintRuntimeAgents";
import { MissionFirstAgents } from "./MissionFirstAgents";
import type { SceneFusionMode } from "./scene-fusion/role-id-bridge";

// ---------------------------------------------------------------------------
// whybuddy-3d-real-role-driven-scene-2026-05-29 / Wave 0 Task 3
// ---------------------------------------------------------------------------
// PetWorkers is the Pet_Workers_Shell: a thin mode-switching orchestrator kept
// as the named-export entrypoint consumed by Scene3D.tsx and ReplayScene3D.tsx.
//
//   - mode === "blueprint"      -> <BlueprintRuntimeAgents .../>
//   - mode === "mission-first"  -> <MissionFirstAgents .../>  (and any other
//                                  value / the default)
//
// The mission-first path stays byte-equivalent to the pre-shell behavior: the
// exact same `projectId / reducedOverlays / mode` props are forwarded into
// MissionFirstAgents. The only new runtime behavior is that blueprint mode now
// mounts BlueprintRuntimeAgents instead of MissionFirstAgents.
//
// PetWorkers renders no React DOM — it is mounted inside the React Three Fiber
// <Canvas>. The `data-testid="whybuddy-3d-shell"` DOM marker is owned by
// Scene3D.tsx (Task 4), not here.

// TODO(Wave 4): BlueprintRuntimeAgents.tsx does not export `AutopilotStage`; it
// keeps a permissive local `type AutopilotStage = string` until a canonical
// stage union exists in the codebase. We mirror the same local alias here so
// the passthrough prop signature matches. Wave 4 will refine both sides to the
// real stage union the owning page passes down.
type AutopilotStage = string;

export function PetWorkers({
  projectId = null,
  reducedOverlays = false,
  mode = "mission-first",
  isReplay,
  latestJobId,
  activeJobId,
  activeStage,
  roleLabels,
}: {
  projectId?: string | null;
  reducedOverlays?: boolean;
  mode?: SceneFusionMode;
  // Optional blueprint-branch passthroughs. Default to undefined so existing
  // mission-first callers (Scene3D.tsx, ReplayScene3D.tsx) compile unchanged.
  isReplay?: boolean;
  latestJobId?: string;
  activeJobId?: string;
  activeStage?: AutopilotStage;
  roleLabels?: Record<string, string>;
}) {
  if (mode === "blueprint") {
    return (
      <BlueprintRuntimeAgents
        isReplay={isReplay}
        latestJobId={latestJobId}
        activeJobId={activeJobId}
        activeStage={activeStage}
        roleLabels={roleLabels}
      />
    );
  }

  return (
    <MissionFirstAgents
      projectId={projectId}
      reducedOverlays={reducedOverlays}
      mode={mode}
    />
  );
}
