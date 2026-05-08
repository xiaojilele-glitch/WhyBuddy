# Runtime Capability Bridge Task List

- [x] 1. Define the runtime capability model
  - [x] 1.1 Define Capability, CapabilityInvocation, CapabilityEvidence, and safety gate contracts.
  - [x] 1.2 Define capability kinds, tags, security levels, availability states, and invocation states.
  - [x] 1.3 Define input/output constraints and evidence payload summary rules.

- [x] 2. Implement the capability registry
  - [x] 2.1 Register Docker, MCP, Skill, AIGC Node, and Role capabilities.
  - [x] 2.2 Support registry reads by kind, security level, tag, and status.
  - [x] 2.3 Bind the registry to blueprint jobs without requiring a real external runtime call.

- [x] 3. Implement runtime adapters
  - [x] 3.1 Implement the deterministic Docker sandbox adapter simulation.
  - [x] 3.2 Implement deterministic MCP and Skill adapter simulations.
  - [x] 3.3 Implement deterministic local AIGC node and role adapter simulations.

- [x] 4. Implement evidence collection and safety gates
  - [x] 4.1 Persist capability invocation output, logs, artifacts, and errors.
  - [x] 4.2 Enforce security levels, network approval, write approval, and disabled capability blocking.
  - [x] 4.3 Bind Capability Evidence back to RouteSet, SPEC tree, and artifact memory lineage.

- [x] 5. Add tests
  - [x] 5.1 Cover capability registry reads.
  - [x] 5.2 Cover runtime invocation scheduling and deterministic evidence output.
  - [x] 5.3 Cover safety gate blocking and artifact evidence persistence.

- [x] 6. Package sandbox derivation jobs
  - [x] 6.1 Bundle one or more capability invocations into a single SandboxDerivationJob.
  - [x] 6.2 Carry roleId, crewId, stage, projectId, routeId, and nodeId through the job contract.
  - [x] 6.3 Support sequential and parallel capability execution inside the same job.
  - [x] 6.4 Aggregate outputs into route outline, main/alternate paths, and evaluation data.

- [x] 7. Emit runtime events and bind role/crew timelines
  - [x] 7.1 Emit capability.invoked, capability.completed, capability.failed, sandbox.job.started, sandbox.job.completed, and sandbox.job.failed events.
  - [x] 7.2 Publish structured events for role and crew context changes.
  - [x] 7.3 Write execution summaries back to RoleTimeline and CrewTimeline.
  - [x] 7.4 Allow frontends and replay surfaces to subscribe by jobId, routeId, or nodeId.

- [x] 8. Extend tests for the new bridge contract
  - [x] 8.1 Cover SandboxDerivationJob packaging and aggregation.
  - [x] 8.2 Cover runtime event emission and subscription filtering.
  - [x] 8.3 Cover role/crew timeline backfill and replay visibility.
