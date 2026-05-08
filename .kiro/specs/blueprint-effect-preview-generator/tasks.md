# Effect Preview Generator Tasks

- [x] 1. Define the preview model
  - [x] 1.1 Define EffectPreview, PreviewNode, prototype cues, and progress milestones
  - [x] 1.2 Bind preview artifacts to SpecTree nodes and source documents
  - [x] 1.3 Define preview status and provenance fields

- [x] 2. Implement the preview planner
  - [x] 2.1 Read SpecTree and accepted SPEC documents
  - [x] 2.2 Select key nodes and preview scope
  - [x] 2.3 Generate progress plans and architecture notes

- [x] 3. Generate preview artifacts
  - [x] 3.1 Generate architecture and flow notes
  - [x] 3.2 Generate page prototype and UI effect cues
  - [x] 3.3 Generate node-level future-state preview records

- [x] 4. Implement the preview menu workbench
  - [x] 4.1 Show preview artifact list
  - [x] 4.2 Support refresh and regeneration
  - [x] 4.3 Show architecture notes, prototype notes, and progress plan

- [x] 5. Add focused tests
  - [x] 5.1 Cover preview generation
  - [x] 5.2 Cover artifact binding and filtering
  - [x] 5.3 Cover workbench rendering

- [x] 6. Bind preview results to runtime projections
  - [x] 6.1 Persist sceneSnapshotId, hudState, logTimeline, and browserPreviewId.
  - [x] 6.2 Bind preview results to SpecNode, RouteSet, or Job identifiers.
  - [x] 6.3 Expose preview state for 3D, HUD, logs, and browser surfaces.
  - [x] 6.4 Add tests for projection binding.

- [x] 7. Sync preview versions with SPEC and progress changes
  - [x] 7.1 Refresh preview versions when SpecTree or stage progress changes.
  - [x] 7.2 Preserve older accepted and rejected preview versions.
  - [x] 7.3 Surface node completion and dependency order in preview outputs.
  - [x] 7.4 Add tests for version refresh and node-state sync.
