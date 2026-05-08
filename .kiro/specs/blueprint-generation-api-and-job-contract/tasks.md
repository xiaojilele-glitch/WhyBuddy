# Generation API And Job Contract Task List

- [x] 1. Define generation contracts
  - [x] 1.1 Define GenerationRequest, GenerationJob, and GenerationStatus
  - [x] 1.2 Define event payloads and error codes
  - [x] 1.3 Define compatibility boundary fields

- [x] 2. Implement job scheduling
  - [x] 2.1 Create jobs and return jobId
  - [x] 2.2 Support staged execution
  - [x] 2.3 Preserve stage artifacts and return partial results

- [x] 3. Implement event broadcast
  - [x] 3.1 Publish status changes
  - [x] 3.2 Publish stage progress and waiting state
  - [x] 3.3 Publish failure explanation

- [x] 4. Add compatibility layer
  - [x] 4.1 Keep existing launch / mission compatible flow reachable
  - [x] 4.2 Allow gradual migration
  - [x] 4.3 Preserve legacy endpoint success semantics

- [x] 5. Write tests
  - [x] 5.1 Contract tests
  - [x] 5.2 Job and artifact tests
  - [x] 5.3 Compatibility tests

- [x] 6. Extend the stage model
  - [x] 6.1 Add clarification, route_generation, spec_tree, spec_docs, preview, prompt_packaging, and engineering_handoff stages.
  - [x] 6.2 Model reviewing as an explicit handoff state with nextAction.
  - [x] 6.3 Allow stage-specific payloads and result shapes.
  - [x] 6.4 Add tests for stage transitions and reviewing semantics.

- [x] 7. Extend the event contract
  - [x] 7.1 Add crew.*, capability.*, preview.*, prompt.*, and mission.* event families.
  - [x] 7.2 Carry jobId, routeId, selectionId, specTreeId, nodeId, and artifactId in event payloads.
  - [x] 7.3 Support frontends subscribing by stage and event family.
  - [x] 7.4 Add tests for event routing and replay visibility.
