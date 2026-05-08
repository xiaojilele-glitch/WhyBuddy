# Autopilot Route Orchestrator Task List

- [x] 1. Define route domain models
  - [x] 1.1 Define RouteSet, RouteCandidate, PrimaryRoute, and AlternativeRoute
  - [x] 1.2 Define risk, cost, and complexity fields
  - [x] 1.3 Define capability usage evidence structures

- [x] 2. Implement the base route orchestrator
  - [x] 2.1 Accept target instructions and GitHub context
  - [x] 2.2 Generate the primary execution path and alternative execution paths
  - [x] 2.3 Summarize route steps, capability pool, and downstream assets

- [x] 3. Implement route review and selection
  - [x] 3.1 Display route outlines, risk, and cost
  - [x] 3.2 Support selecting, merging, reselecting, and rolling back routes
  - [x] 3.3 Persist the user's final decision

- [x] 4. Implement route asset persistence
  - [x] 4.1 Write RouteSet to project assets
  - [x] 4.2 Record provenance and evidence
  - [x] 4.3 Provide route output as the source for SPEC tree derivation

- [x] 5. Write tests
  - [x] 5.1 Route generation tests
  - [x] 5.2 Capability pool structure tests
  - [x] 5.3 Route selection, merge, rollback, and persistence tests

- [x] 6. Wire structured clarification into route generation
  - [x] 6.1 Accept clarification strategy mode as route input.
  - [x] 6.2 Carry readiness signals, source evidence, and question answers into RouteSet generation.
  - [x] 6.3 Support target-first, repository-first, risk-first, document-first, preview-first, and fast-execution clarification modes.
  - [x] 6.4 Add tests for strategy-driven route generation.

- [x] 7. Package route generation as sandbox derivation jobs
  - [x] 7.1 Dispatch Docker, MCP, Skills, role analyzers, and AIGC nodes through Runtime Capability Bridge.
  - [x] 7.2 Aggregate sandbox outputs into route outline, primary route, alternative route, risk, cost, and complexity fields.
  - [x] 7.3 Record job status, duration, evidence, artifacts, and output summaries.
  - [x] 7.4 Add tests for sandbox derivation aggregation and evidence persistence.

- [x] 8. Make SPEC Tree reviewing an explicit handoff state
  - [x] 8.1 Represent reviewing as confirmable, editable, and resumable handoff state.
  - [x] 8.2 Show next actions for confirm, fine-tune, reselect route, merge route, and enter downstream menus.
  - [x] 8.3 Persist routeId, selectedPathId, specTreeId, provenance, and job artifact links.
  - [x] 8.4 Add tests for reviewing state transitions and route-to-spec lineage.
