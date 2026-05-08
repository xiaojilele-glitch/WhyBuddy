# Agent Crew Fabric Task List

- [x] 1. Define the role catalog
  - [x] 1.1 Define decision, planning, execution, audit, presentation, and memory role groups
  - [x] 1.2 Define stable role ids, names, responsibilities, permissions, and default stages
  - [x] 1.3 Add product-facing Chinese role labels for `/autopilot`

- [x] 2. Define the role capability matrix
  - [x] 2.1 Define RoleCapability and CapabilityBinding contracts
  - [x] 2.2 Bind AIGC nodes, Docker, MCP, Skills, GitHub, Browser, SVG, docs, and retrieval capabilities to roles
  - [x] 2.3 Require roleId and capabilityId on every capability invocation

- [x] 3. Implement stage activation policy
  - [x] 3.1 Define active, watching, reviewing, and sleeping role states
  - [x] 3.2 Define default role policies for clarification, RouteSet, SPEC tree, spec docs, preview, prompts, and engineering landing
  - [x] 3.3 Support risk, cost, and complexity based role activation overrides

- [x] 4. Connect Agent Crew to the runtime event stream
  - [x] 4.1 Emit role.activated, role.watching, role.capability_invoked, role.review_started, role.review_completed, and role.completed events
  - [x] 4.2 Include jobId, projectId, stage, roleId, presenceState, capabilityId, artifactId, and evidenceId in role events
  - [x] 4.3 Let 3D, HUD, logs, browser, and SPEC UI consume the same role event stream

- [x] 5. Persist role timelines
  - [x] 5.1 Write RoleTimeline records to artifact memory
  - [x] 5.2 Support replay by role, stage, node, artifact, and time range
  - [x] 5.3 Reuse previous role findings in later route or SPEC derivation runs

- [x] 6. Add the frontend companion role surface
  - [x] 6.1 Show active, watching, reviewing, and sleeping roles on `/autopilot`
  - [x] 6.2 Show each role's current action and latest artifact
  - [x] 6.3 Keep role state aligned with 3D scene, HUD, logs, and browser preview

- [x] 7. Add tests
  - [x] 7.1 Role catalog and binding tests
  - [x] 7.2 Stage activation policy tests
  - [x] 7.3 Runtime event stream tests
  - [x] 7.4 Role timeline replay tests
  - [x] 7.5 Frontend role state rendering tests
