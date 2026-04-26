<p align="center">
  <img src="./docs/assets/banner.png" alt="Cube Pets Office banner" width="100%" />
</p>

<h1 align="center">Cube Pets Office</h1>

<p align="center">
  <a href="./README.md"><strong>English</strong></a> |
  <a href="./README.zh-CN.md"><strong>Simplified Chinese</strong></a>
</p>

<p align="center">
  <strong>Task Autopilot / 任务自动驾驶平台 for AI agents</strong><br/>
  Cube Pets Office is a Task Autopilot platform for complex work: enter a destination, inspect the route, let the system execute what is safe, and take over when human judgment is required.
</p>

<p align="center">
  <a href="https://opencroc.github.io/cube-pets-office/"><strong>Live Demo</strong></a>
</p>

<p align="center">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-111827" />
  <img alt="frontend" src="https://img.shields.io/badge/frontend-React%2019%20%2B%20Vite-2563eb" />
  <img alt="server" src="https://img.shields.io/badge/server-Node%20%2B%20Express-0f766e" />
  <img alt="executor" src="https://img.shields.io/badge/executor-Lobster-7c3aed" />
  <img alt="3d" src="https://img.shields.io/badge/3D-Three.js-f97316" />
  <img alt="autopilot" src="https://img.shields.io/badge/task%20autopilot-18%20phase--1%20specs-0f766e" />
  <img alt="pages" src="https://img.shields.io/badge/demo-GitHub%20Pages-0ea5e9" />
</p>

---

## What It Is

Cube Pets Office is evolving from a mission-first task operating system into a Task Autopilot platform.

It is not a chat playground where the main artifact is an answer. It is not only a workflow builder where users must manually draw every node. It is also not an agent platform whose main value is browsing agent, tool, or plugin catalogs. The product direction is to let a user state a goal, then make the task lifecycle visible and controllable:

- understand the intended destination and missing context
- recommend an executable route instead of exposing every low-level node first
- organize a role-based agent fleet around the route
- run work through the existing mission runtime, workflow engine, and executor stack
- surface drive state, logs, artifacts, evidence, audit records, and replay
- pause for clarification, approval, risk acceptance, budget, permission, or delivery review when needed
- replan when the current route is no longer safe, complete, or useful

The current engineering foundation remains mission-first. Task Autopilot is the next product layer above it: `mission / workflow / runtime / task` continue to be the implementation vocabulary, while `Destination / Route / Drive State / Fleet / Takeover` become the user-facing vocabulary.

---

## Current Reality

This README intentionally keeps the product story aligned with the codebase and specs that exist today.

What is already present as foundation:

- A mission-first office shell and `/tasks` workbench for launching, monitoring, and reviewing task execution.
- A Node + Express + Socket.IO server that coordinates mission state, workflow progress, events, replay, and APIs.
- A Lobster executor service with `mock`, `native`, and `real` execution modes, including Docker-aware local behavior.
- Human-in-the-loop control paths such as wait/resume, decision handling, approvals, and manual recovery hooks.
- Review, audit, replay, lineage, evidence, and runtime observability concepts across existing specs and mainline integration.
- A Web-AIGC mainline baseline where `58 / 58` specs have been closed and multiple node/route families have been integrated into the server mainline.
- A first-phase Task Autopilot specification baseline: `18` specs, each with `requirements.md`, `design.md`, and `tasks.md`.

What is not being claimed:

- The project is not an open-domain L5 fully autonomous operator.
- The system does not promise to complete every complex task without human review.
- High-risk side effects, permission changes, external writes, budget-sensitive actions, and ambiguous goals still require explicit governance and takeover.
- The new product language does not require an immediate large-scale rename of the existing `mission / workflow / runtime` code.
- The 18 Task Autopilot specs are a completed first-phase documentation and modeling baseline; their implementation task checklists are intentionally the next body of work.

---

## From Mission-First To Task Autopilot

The previous product center was mission-first:

- A user launches a mission instead of asking for a one-off reply.
- The system tracks workflow stages, runtime state, artifacts, and decisions.
- Replay and audit preserve enough evidence to inspect what happened.
- `/` and `/tasks` are the high-frequency execution surfaces.

Task Autopilot keeps that foundation and adds a clearer product model:

| Mission-first foundation            | Task Autopilot product layer | Meaning                                                   |
| ----------------------------------- | ---------------------------- | --------------------------------------------------------- |
| `mission`                           | `Destination`                | The outcome the user wants to reach                       |
| `workflow`                          | `Route`                      | The planned path toward the destination                   |
| runtime / phase state               | `Drive State`                | The user-readable state of the task journey               |
| agents / skills / nodes / executors | `Fleet`                      | The role-based capability group assembled for the route   |
| HITL / decision / approval          | `Takeover Point`             | A moment where the system gives control back to the user  |
| retry / revision / reroute          | `Replan`                     | A formal route change after risk, failure, or new context |

This is a compatibility-first evolution. The product layer should be implemented through bindings, projections, view models, and server-side aggregation before any deep rename or schema rewrite is considered.

---

## Core Concepts

Task Autopilot is organized around a small set of product objects.

| Concept          | Product meaning                                                                                                                                  | Current implementation anchor                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `Destination`    | A structured form of the user's intended outcome, including goal, constraints, missing information, success criteria, and expected deliverables. | Mission metadata, mission summary, runtime context, workflow config                |
| `Route`          | A recommended executable path with stages, candidate routes, risks, takeover points, expected artifacts, and possible replans.                   | Workflow definition, workflow instance, route family, workflow phase               |
| `Drive State`    | A high-level state machine that explains what the system is doing now.                                                                           | Mission runtime state, workflow state, node state, wait/resume state, review state |
| `Fleet`          | A role-oriented capability group such as Planner, Clarifier, Researcher, Operator, Generator, Reviewer, Auditor, and Coordinator.                | Agents, skills, tools, Web-AIGC nodes, MCP tools, executors, adapters              |
| `Takeover Point` | A user decision point for clarification, route selection, permission, budget, risk acceptance, delivery acceptance, or exception handling.       | HITL, MissionDecision, approval, `WAITING_INPUT`, `resume()`, `escalate()`         |
| `Replan`         | A route-level change caused by new constraints, lower confidence, elevated risk, failed tools, poor intermediate results, or user override.      | Workflow revision, retry/escalate paths, reroute records, runtime events           |
| `Confidence`     | The system's confidence in goal understanding, route feasibility, execution completion, and result quality.                                      | Runtime projection, review signals, evidence completeness, UI explanation layer    |
| `Risk`           | A structured view of ambiguity, missing data, tool failure, permissions, cost, compliance, external side effects, and result quality.            | Runtime governance, audit, permission checks, risk actions, replay evidence        |

The main chain is:

```text
Destination -> Route -> Fleet -> Drive State -> Result
```

Takeover, replan, confidence, risk, evidence, audit, and replay make that chain inspectable rather than a black box.

---

## Autopilot Levels

The Task Autopilot specs define L1-L5 as an execution commitment model, not as marketing shorthand. The repository should not be described as globally L5.

| Level | Meaning                                                                                                                                             | Current positioning                                                    |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `L1`  | Route suggestion level. The system helps interpret the destination and recommend a route, while the user remains in control of execution.           | A practical near-term baseline for productization.                     |
| `L2`  | Partial automatic execution. Low-risk steps may progress automatically, while key decisions require takeover.                                       | A realistic target for current mission-first + HITL foundations.       |
| `L3`  | Standard task automatic closure. Standardized tasks can mostly complete automatically inside bounded risk, review, audit, and recovery constraints. | A near-term design target for selected, well-governed task families.   |
| `L4`  | High automation inside limited task domains. Requires whitelist policies for task domain, permissions, budget, and evidence.                        | Future limited-domain direction, not a blanket current claim.          |
| `L5`  | Open-domain full automation.                                                                                                                        | Research and long-term concept only; not implemented or claimed today. |

The intended implementation model is task-level and phase-level. A mission may start with a target level, then downgrade when it hits risk, missing context, external side effects, or governance boundaries.

---

## Phase-1 Task Autopilot Specs

The first Task Autopilot phase has completed its spec modeling baseline: `18` specs across `54` markdown files. Each spec has:

- `requirements.md`
- `design.md`
- `tasks.md`

The current status is documentation-complete for phase 1, not implementation-complete for every task in those specs. The unchecked task lists are the next implementation backlog.

### P0: Product Definition And Object Model

- `task-autopilot-platform-positioning`: defines Task Autopilot as the next product layer above mission-first.
- `task-autopilot-core-concepts`: defines Destination, Route, Drive State, Fleet, Takeover, Replan, Confidence, and Risk.
- `task-autopilot-levels-l1-to-l5`: defines automation levels and prevents overclaiming open-domain autonomy.
- `destination-model-and-parser`: defines how user input becomes a structured destination.
- `route-planner-and-route-model`: defines route sets, candidate routes, stages, risks, and takeover points.
- `mission-model-to-autopilot-model-mapping`: defines the compatibility bridge from `mission / workflow / runtime` to the autopilot product model.

### P1: Cockpit And Operator Experience

- `autopilot-cockpit-information-architecture`: defines the cockpit IA for destination, route, execution, takeover, evidence, and audit.
- `destination-card-and-goal-summary`: defines the destination card and stable goal summary.
- `route-recommendation-and-selection`: defines fastest, safest, and deepest route recommendation semantics.
- `fleet-status-and-live-execution-view`: defines the live fleet execution view above agents, nodes, executors, logs, and artifacts.
- `takeover-panel-and-decision-points`: defines unified takeover experiences for clarification, route confirmation, budget, permission, risk, delivery, and exceptions.
- `drive-state-and-replan-state-machine`: defines the high-level drive states and replan semantics.

### P2: Runtime, Governance, Evidence, And Metrics

- `fleet-organization-and-role-packaging`: defines role packaging and maps agents, skills, nodes, tools, MCP, and executors into fleet roles.
- `autopilot-runtime-orchestration`: defines how Destination, Route, Fleet, and Takeover bind into Mission Runtime, workflow runtime, decisions, and executor signals.
- `autopilot-explainability-and-telemetry`: defines explanations, telemetry signals, confidence, risk, remaining steps, and evidence hints.
- `autopilot-recovery-and-human-takeover-governance`: defines recovery, downgrade, escalation, and human takeover governance.
- `autopilot-evidence-replay-and-trust-chain`: defines the driving timeline, evidence chain, replay chain, and trust chain.
- `task-autopilot-success-metrics`: defines delivery rate, takeover rate, replan rate, deviation rate, completion time, review pass rate, and drill-down evidence.

The next implementation direction is to connect these specs into the running product incrementally: projection objects first, cockpit surfaces second, runtime events and governance third, then replay/audit/metrics closure.

---

## Core Surfaces

- `/` is the default office cockpit. It brings the task queue, 3D office scene, unified launch surface, and right-side context into one desktop shell.
- `/tasks` is the full-screen task workbench for focused execution and monitoring.
- `/tasks/:taskId` keeps deep-linked task detail pages available.
- `/replay/:missionId` is the replay surface for completed runs and evidence review.
- `/debug` remains a lower-frequency internal surface for diagnostics and supporting tools.

The current surface strategy is to keep the office cockpit and `/tasks` as the main operator work areas. Replay, audit, lineage, debug, and lower-level node views remain available without becoming the first thing a user must understand.

---

## Architecture

<p align="center">
  <img src="./docs/assets/diagram.png" alt="Cube Pets Office architecture overview" width="100%" />
</p>

<p align="center">
  <img src="./docs/architecture.svg" alt="Cube Pets Office architecture map" width="100%" />
</p>

At a high level, the repository is organized around four layers:

- `client/`: React 19 + Vite frontend, including the office shell, task workbench, replay views, 3D scene, launch surfaces, and cockpit components.
- `server/`: Node.js + Express + Socket.IO backend for missions, workflow state, events, replay, Web-AIGC routes, and APIs.
- `services/lobster-executor/`: execution service for mock, native, and real task execution.
- `shared/`: contracts and shared types used across frontend, backend, and executor.

The Task Autopilot architecture should be added as a product/projection layer above these foundations:

```text
Product layer:   Destination / Route / Drive State / Fleet / Takeover / Evidence
Projection layer: bindings, view models, server aggregation, event normalization
Runtime layer:   Mission Runtime / workflow engine / HITL / review / audit / replay
Execution layer: Lobster executor / adapters / tools / Web-AIGC nodes / external services
```

The runtime architecture SVG is available here:

- [docs/architecture.svg](./docs/architecture.svg)
- [docs/architecture-runtime-2026-04-21.svg](./docs/architecture-runtime-2026-04-21.svg)

---

## Web-AIGC Mainline

The Web-AIGC spec delivery baseline is closed at `58 / 58` completed specs and `238 / 238` checked top-level tasks, spanning `52` node specs and `6` platform specs. The project has moved from spec-count tracking into mainline integration, runtime hardening, and governance closure.

This matters for Task Autopilot because the Web-AIGC work supplies much of the lower-level route and fleet substrate:

- Built-in adapters, installed extra adapters, wait/resume control flow, and replay/audit observability are already part of the runtime mainline.
- The main server entry mounts multiple Web-AIGC route families, including MCP, Office/content nodes, search and QA, `transaction_flow`, `orchestration_recognition_jump`, and vector update/delete endpoints.
- Runtime coverage includes search/QA adapters, Office/content production nodes such as `ai_ppt`, `excel_read`, `dynamic_chart`, `file_slicing`, `file_generation`, and `file_translation`, plus governed execution paths such as `transaction_flow` and `orchestration_recognition_jump`.

Task Autopilot should not expose all of those nodes as the primary product mental model. It should package them into route stages, fleet roles, takeover points, and evidence trails.

For dated status snapshots and integration planning, see the steering docs linked in the documentation section below.

---

## Runtime Modes

The repo currently has three practical runtime targets:

| Environment                 | Frontend | Server | Executor behavior               |
| --------------------------- | -------- | ------ | ------------------------------- |
| GitHub Pages preview        | Yes      | No     | Browser-only preview runtime    |
| Local with Docker available | Yes      | Yes    | `real` executor mode            |
| Local without Docker        | Yes      | Yes    | `native` executor mode fallback |

Important boundaries:

- GitHub Pages is a static preview target. It does not include the Node server or Lobster Executor.
- `pnpm run dev:all` prefers `real` execution and automatically falls back to `native` when Docker is unavailable.
- If you explicitly set `LOBSTER_EXECUTION_MODE=mock` or `LOBSTER_EXECUTION_MODE=native`, that choice is preserved.

For executor details, see [docs/executor/lobster-executor.md](./docs/executor/lobster-executor.md).

---

## Implementation Direction

The next Task Autopilot implementation work should stay incremental and compatibility-first.

Recommended sequence:

1. Add stable projection objects for `Destination`, `Route`, `Drive State`, `Fleet`, and `Takeover` without renaming the existing runtime foundation.
2. Use those projections to upgrade the office cockpit, `/tasks`, and task detail surfaces into a clearer autopilot cockpit.
3. Connect route recommendation, route selection, takeover, downgrade, and replan actions to existing mission/workflow/runtime control paths.
4. Normalize runtime, decision, audit, replay, artifact, and lineage events into an evidence chain that can explain why the task moved the way it did.
5. Add success metrics only where the required source-of-truth data exists, and mark partial or conflicted samples explicitly.

Guardrails:

- Do not turn Task Autopilot into a UI-only rebrand; every visible state should point back to runtime facts or clearly marked inference.
- Do not force users to manage 50+ nodes as the main flow; package capabilities into route stages and fleet roles.
- Do not hide governance behind "automation"; high-risk actions must remain auditable and interruptible.
- Do not treat replay as the source of truth when mission/runtime/audit facts disagree; replay is primarily a reconstruction and review surface.

---

## Quick Start

This repository uses `pnpm`. If `pnpm` is not installed globally, you can replace commands below with `corepack pnpm`.

### 1. Preview the frontend only

No API key is required for the browser-only preview flow.

```bash
pnpm install --frozen-lockfile
pnpm run dev:frontend
```

Use this when you want to explore the office shell, the 3D scene, and the demo experience quickly.

### 2. Start the full local stack

Create a local environment file first:

```bash
cp .env.example .env
```

PowerShell alternative:

```powershell
Copy-Item .env.example .env
```

Then fill the values you need in `.env` and start the stack:

```bash
pnpm run dev:all
```

Common AI-related variables:

```dotenv
LLM_API_KEY=your_api_key_here
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-5.4
LLM_WIRE_API=responses
```

### 3. Run services separately

This is useful when you want to debug the frontend, server, and executor independently.

```bash
pnpm run dev:server
pnpm run dev:frontend
```

Start the executor with an explicit mode:

```bash
LOBSTER_EXECUTION_MODE=real pnpm exec tsx services/lobster-executor/src/index.ts
```

PowerShell example:

```powershell
$env:LOBSTER_EXECUTION_MODE='native'
pnpm exec tsx services/lobster-executor/src/index.ts
```

---

## Release Guardrails

Useful commands:

- `pnpm run lint`: check the guarded formatting targets used by release docs and workflows.
- `pnpm run typecheck`: run the TypeScript no-emit check.
- `pnpm run test`: run client, server, and executor test entrypoints.
- `pnpm run build`: build the frontend and server bundle.
- `pnpm run test:guardrails`: run the lighter decision and socket reconnect regression path.
- `pnpm run test:release`: run the pre-release aggregate check.
- `pnpm run build:pages`: build the GitHub Pages artifact.

For release-sensitive changes, the practical minimum is:

```bash
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
```

---

## Repository Layout

```text
cube-pets-office/
|-- client/                    # frontend app: office shell, tasks, replay, 3D scene
|-- server/                    # backend APIs, workflow state, events, replay
|-- shared/                    # shared contracts and types
|-- services/lobster-executor/ # executor service: mock / native / real
|-- docs/                      # architecture, executor notes, reference docs
|-- scripts/                   # local dev, build, smoke, and utility scripts
|-- data/                      # local data and persisted runtime files
`-- .kiro/                     # specs, steering, and execution planning artifacts
```

If you want to start from key entrypoints, read these first:

- [client/src/App.tsx](./client/src/App.tsx)
- [client/src/pages/Home.tsx](./client/src/pages/Home.tsx)
- [client/src/pages/tasks/TasksPage.tsx](./client/src/pages/tasks/TasksPage.tsx)
- [client/src/components/office/OfficeTaskCockpit.tsx](./client/src/components/office/OfficeTaskCockpit.tsx)
- [server/index.ts](./server/index.ts)
- [server/core/workflow-engine.ts](./server/core/workflow-engine.ts)
- [services/lobster-executor/src/index.ts](./services/lobster-executor/src/index.ts)

---

## Documentation

- [ROADMAP.md](./ROADMAP.md)
- [CHANGELOG.md](./CHANGELOG.md)
- [docs/architecture.svg](./docs/architecture.svg)
- [docs/architecture-runtime-2026-04-21.svg](./docs/architecture-runtime-2026-04-21.svg)
- [docs/executor/lobster-executor.md](./docs/executor/lobster-executor.md)
- [.kiro/steering/task-autopilot-spec-roadmap-2026-04-23.md](./.kiro/steering/task-autopilot-spec-roadmap-2026-04-23.md)
- [.kiro/steering/execution-plan.md](./.kiro/steering/execution-plan.md)
- [.kiro/steering/spec-execution-roadmap.md](./.kiro/steering/spec-execution-roadmap.md)
- [.kiro/steering/web-aigc-58-plan-progress-summary-2026-04-22.md](./.kiro/steering/web-aigc-58-plan-progress-summary-2026-04-22.md)
- [.kiro/steering/web-aigc-runtime-mainline-checkpoints-2026-04-23.md](./.kiro/steering/web-aigc-runtime-mainline-checkpoints-2026-04-23.md)
- [.kiro/steering/web-aigc-phase-2-integration-plan.md](./.kiro/steering/web-aigc-phase-2-integration-plan.md)
- [.kiro/steering/web-aigc-next-phase-mainline-plan-2026-04-22.md](./.kiro/steering/web-aigc-next-phase-mainline-plan-2026-04-22.md)
- [.kiro/specs/task-autopilot-platform-positioning/](./.kiro/specs/task-autopilot-platform-positioning/)
- [.kiro/specs/task-autopilot-core-concepts/](./.kiro/specs/task-autopilot-core-concepts/)
- [.kiro/specs/task-autopilot-levels-l1-to-l5/](./.kiro/specs/task-autopilot-levels-l1-to-l5/)
- [.kiro/specs/mission-model-to-autopilot-model-mapping/](./.kiro/specs/mission-model-to-autopilot-model-mapping/)
- [.kiro/specs/](./.kiro/specs/)

`README.md` is kept as stable product documentation for GitHub. Rolling progress, active implementation details, and dated execution notes belong in `ROADMAP.md`, `.kiro/steering/`, and the spec archives.

---

## FAQ

### I do not have `pnpm` installed

Use `corepack pnpm` in place of `pnpm`, for example:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run test:release
```

### Why is GitHub Pages not the same as `native` mode?

Because GitHub Pages is a static deployment target. It has no local backend process and no local executor. The Pages demo is browser-only preview runtime, not host-process execution.

### Is Task Autopilot already fully implemented?

No. The mission-first runtime foundation exists, the Web-AIGC mainline is integrated, and the first `18` Task Autopilot specs are documented. The next work is to land the projection layer, cockpit experience, runtime orchestration fields, takeover governance, evidence chain, and metrics in production code.

### Does Task Autopilot require renaming all existing mission code?

No. The specs explicitly recommend compatibility first. Keep `mission / workflow / runtime / task` as the engineering layer, then add `Destination / Route / Drive State / Fleet / Takeover` as product-facing projections and shared vocabulary.

### What should I run before opening a PR?

At minimum:

```bash
pnpm run lint
pnpm run typecheck
pnpm run test
```

If your change affects packaging, deployment, or end-to-end runtime behavior, also run:

```bash
pnpm run build
pnpm run test:release
```

---

## License

MIT

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=opencroc/cube-pets-office&type=Date)](https://star-history.com/#opencroc/cube-pets-office&Date)
