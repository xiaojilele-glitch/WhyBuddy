# Artifact Memory and Replay Tasks

- [x] 1. Define the artifact and replay model
  - [x] 1.1 Define Artifact, Replay, Timeline, and ProvenanceGraph
  - [x] 1.2 Define version, source, and timestamp fields
  - [x] 1.3 Define stage and comparison metadata

- [x] 2. Implement the Artifact Ledger
  - [x] 2.1 Persist routes, trees, documents, previews, prompts, and run results
  - [x] 2.2 Build source and version indexes
  - [x] 2.3 Provide project-level artifact queries

- [x] 3. Implement replay and comparison
  - [x] 3.1 Replay route generation
  - [x] 3.2 Replay document and execution evolution
  - [x] 3.3 Compare differences between versions

- [x] 4. Implement feedback backfill
  - [x] 4.1 Backfill into RouteSet
  - [x] 4.2 Backfill into SpecTree and SpecDocument
  - [x] 4.3 Preserve historical versions and logs

- [x] 5. Add focused tests
  - [x] 5.1 Cover artifact persistence
  - [x] 5.2 Cover replay behavior
  - [x] 5.3 Cover feedback backfill

- [x] 6. Ingest runtime event timelines
  - [x] 6.1 Persist clarification, sandbox, role, crew, capability, route, spec, preview, prompt, mission, and evidence events.
  - [x] 6.2 Index events by jobId, projectId, nodeId, version, crewId, roleId, and capabilityId.
  - [x] 6.3 Keep event provenance and evidence pointers alongside artifacts.
  - [x] 6.4 Add tests for event ingestion and querying.

- [x] 7. Extend replay to runtime and team state
  - [x] 7.1 Replay RouteSet, SpecTree, SpecDocument, EffectPreview, and PromptPackage evolution.
  - [x] 7.2 Restore 3D scene, HUD, browser, crew, role, and capability states in replay.
  - [x] 7.3 Preserve user confirmations and handoff decisions.
  - [x] 7.4 Add tests for runtime-state replay and team-state recovery.
