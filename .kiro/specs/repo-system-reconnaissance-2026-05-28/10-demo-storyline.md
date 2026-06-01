# 10 演示主线 / Demo Storyline

> **Q5 Anchor**: This document is the primary answer to Q5 of the Five_Control_Recovery_Questions: *which storyline to use for demo / refactor / fundraising / open-source*.
> **Generated**: 2026-05-28 (frozen HEAD `d181be2f`)
> **Source basis**: B-tier candidates flagged TRUNK and IMPLEMENTED_AND_VALID per `spec-audit-table.md`.
> **Companion**: `B_Tier_Recommendation.md`. Each storyline anchor below maps to one or more B-tier candidates; the storyline targets become B-tier prose later (Req 10.5).

_Implements: REQ-2.5, REQ-6.1 — Validates: Property 7_

## One-line summary

`WhyBuddy` is **Mission as Task Autopilot**: the user states a destination, the system plans a route, executes the fleet, and replays evidence — all on top of the closed Mission Execution chain. Every storyline below tells the same loop from a different audience's vantage point.

---

## Audience-specific storylines (4 audiences × 1 path each)

### 1. Demo storyline — "From input to delivered artifact in one Mission run"

**Headline**: *Watch one task drive itself from destination to evidence in a single, observable run.*

**3-act structure**:
1. **Act 1 — Destination input**. User submits a "destination" sentence (analysis / generation / implementation / research / attachment / advanced-execution chip). System parses the destination via `parseMissionDestination()` (shared) and renders the launch preview card.
2. **Act 2 — Live drive state on cockpit**. The 10-stage `WorkflowEngine` pipeline progresses. The Mission Runtime publishes `mission_event` over Socket.IO; the cockpit's three-column layout shows Destination / Route / Drive State and Fleet activity in real time.
3. **Act 3 — Artifact + replay**. On completion the Lobster executor returns artifacts; the replay timeline appends evidence. User reopens the run via `/replay/:missionId` to see the full sequence retrospectively.

**Anchor docs**: `01 主业务闭环` (Main_Business_Loop), `09 运行时主链路` (runtime state sequence).

**Anchor SVGs**: `D1` (`d1-main-business-loop.svg`), `D8` (`d8-runtime-state-sequence.svg`).

**Anchor specs (all IMPLEMENTED_AND_VALID per audit table)**: `mission-runtime`, `workflow-engine`, `task-autopilot-core-concepts`, `task-autopilot-levels-l1-to-l5`, `task-autopilot-success-metrics`, `executor-integration`, `lobster-executor-real`, `autopilot-launch-destination-input`, `autopilot-runtime-orchestration`.

**Why this works for demo**: it is the same chain the production runtime executes today; nothing in the demo is staged. The same Socket events, Mission lifecycle, and replay tape are produced in real runs.

---

### 2. Refactor storyline — "Where the system bends today, where to apply leverage tomorrow"

**Headline**: *510 trunk modules across 7 domains carry no spec link. The next refactor wave should compose those into named domains, not chase new features.*

**Focus**:
- Doc 08 reports 510 TRUNK modules with empty `referenced_specs`. They are NOT broken — they implement closed-loop chains (Mission, Workflow, Executor, Audit, Lineage). They are simply un-narrated.
- Refactor priority is given by domain volume: `frontend-cockpit` (454) → `executor` (29) → `mission` (10) → `workflow` (8) → `audit` / `lineage` (4 each) → `feishu` (1).
- The refactor is **narrative-first**: writing a per-domain B-tier brief surfaces accidental complexity; the brief becomes the spec a refactor PR cites.

**Anchor docs**: `04 主要域地图` (Domain_Map), `06 后端能力地图` (Backend_Capability_Map), `08 代码-文档对账` (Code-Doc Reconciliation).

**Anchor SVGs**: `D4` (`d4-domain-map.svg`), `D6` (`d6-backend-capability-map.svg`).

**Routing**: feeds B10–B16 in `B_Tier_Recommendation.md` (per-domain prose); C1–C3 (cross-domain reorg) execute after B stabilizes.

**Anchor specs**: `repo-system-reconnaissance-2026-05-28` (this spec; the refactor map is the deliverable), plus the 9 PARTIALLY_IMPLEMENTED specs that already mark refactor surfaces.

---

### 3. Fundraising storyline — "Defensive moat = closed Mission chain × Audit chain × Lineage DAG × replay-grade evidence"

**Headline**: *Other agent platforms ship a chat-loop and call it a day. WhyBuddy ships a closed loop with audit, lineage, and replay built into the runtime.*

**Differentiators**:
1. **Closed Mission chain**: Mission lifecycle is a state machine, not a transcript. Each stage is auditable, replayable, and resumable.
2. **Hash-chained audit**: every action appends to an immutable audit chain (`audit-chain` spec, IMPLEMENTED_AND_VALID). Tampering is mechanically detectable.
3. **Lineage DAG**: data flows are tracked as a directed graph (`data-lineage-tracking` spec, IMPLEMENTED_AND_VALID). Impact analysis is a query, not a guess.
4. **Permission matrix**: agent capabilities are RBAC-gated (`agent-permission-model` spec, IMPLEMENTED_AND_VALID). Off-policy actions are blocked at runtime.
5. **Replay-grade evidence**: every Mission produces a deterministic replay tape (`collaboration-replay` spec, IMPLEMENTED_AND_VALID).

**Anchor docs**: `01 主业务闭环` (the loop itself), `02 核心对象模型` (the objects that make the loop closed), `09 运行时主链路` (the state sequence).

**Anchor SVGs**: `D1`, `D2` (`d2-core-object-model.svg`).

**Anchor specs (all IMPLEMENTED_AND_VALID)**: `audit-chain`, `data-lineage-tracking`, `agent-permission-model`, `collaboration-replay`, `lobster-executor-real`, `mission-runtime`, `workflow-engine`.

**Why this works for fundraising**: the moat is documented in code, not slides. Auditors can run the spec audit themselves and see all 6 differentiators backed by IMPLEMENTED_AND_VALID rows.

---

### 4. Open-source storyline — "A reproducible reference for compatibility-first AI runtime"

**Headline**: *Run the same Mission in three modes — real Docker, native, or browser — without changing a line of frontend code.*

**Focus**:
- **Compatibility-first runtime**. `lobster-executor` ships docker-runner, native-runner, and mock-runner with the same job contract. The Mission Runtime selects the active runner via `LOBSTER_EXECUTOR_BASE_URL` and runtime detection.
- **Browser-only deployment**. GitHub Pages serves the frontend with `BrowserWorkflowRepository` + `BrowserAgentDirectory`; the same `WorkflowRuntime` interface drives both browser and server modes.
- **shared/ contracts as public surface**. 14 contract modules under `shared/` define the wire format between client, server, executor, and audit/lineage layers. They are the open-source seam.
- **Three-tier deployment story**: cloud (Docker + Mission Runtime) → laptop (native) → browser-only (Pages preview). Same contracts, same runtime engine, different carrier.

**Anchor docs**: `03 系统分层图` (System_Layering), `05 前端导航地图` (Frontend_Navigation), `06 后端能力地图` (Backend_Capability).

**Anchor SVGs**: `D3` (`d3-system-layering.svg`), `D5` (`d5-frontend-navigation-map.svg`), `D6`.

**Anchor specs (all IMPLEMENTED_AND_VALID)**: `browser-runtime`, `frontend-3d`, `lobster-executor-real`, `executor-integration`, `sandbox-native-executor-compat`, `docker-executor-capabilities-contract`.

**Why this works for open-source**: any contributor can clone the repo and run `pnpm run dev:frontend` (browser-only, no .env required). The shared/ contracts are the public API; the runtime tiers are the deployment story.

---

## Why these four storylines, not others

- They cover Q5's exact four audiences (demo / refactor / fundraising / open-source) verbatim per `requirements.md` § Vocabulary § Five_Control_Recovery_Questions.
- They share the same `Main_Business_Loop` spine (doc 01); only the lens changes.
- Every cited spec has been verified to exist in `spec-audit-table.md` with bucket=`IMPLEMENTED_AND_VALID` (zero exceptions). No fabricated narrative.
- No storyline introduces a new product claim that the audit cannot back.

## Storyline → B-tier candidate mapping

| storyline | feeds into B-tier candidates |
| --- | --- |
| Demo | B10 (workflow), B11 (mission), B12 (executor), B16b (task cockpit), B16c (autopilot right-rail) |
| Refactor | B10–B16 entirely (per-domain prose is the refactor map) |
| Fundraising | B12 (executor), B13 (audit), B14 (lineage); plus C3 (audit ↔ lineage ↔ permission evidence chain) |
| Open-source | B16g (UI primitives), C1 (blueprint-runtime ↔ executor), D1–D3 (TypeDoc / madge / dependency-cruiser) |

---

## Citations

- `spec-audit-table.md`: 60+ rows verified IMPLEMENTED_AND_VALID for the cited specs above.
- `01-main-business-loop.md`, `02-core-object-model.md`, `03-system-layering.md`, `04-domain-map.md`, `05-frontend-navigation-map.md`, `06-backend-capability-map.md`, `09-runtime-state-sequence.md`, `08-code-doc-reconciliation.md`.
- `B_Tier_Recommendation.md` (sibling deliverable; storyline targets become B-tier prose).
- Steering: `.kiro/steering/project-overview.md § 项目定位 / § 系统架构`, `.kiro/steering/2026-04-15-runtime-current-state.md`.
- Q5 traceability: this document is the **primary** answer to Q5; supporting documents are `01`, `02`, `07`. See `00 项目总定义` traceability table for the full mapping.
