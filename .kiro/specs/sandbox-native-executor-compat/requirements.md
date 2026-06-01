# Requirements

## Summary

This spec archives the sandbox-compatible execution changes that landed through the
`trae/solo-agent-ENNSlg` branch and the local follow-up dev startup fixes.

The main goal is to preserve a clear record of how WhyBuddy behaves when:

- Docker is available locally
- Docker is unavailable locally, but Node processes can still run
- the app is deployed as a static GitHub Pages build, where neither server nor executor can run

This spec does not introduce new product scope. It records the implemented behavior,
the environment boundaries, and the developer workflow expectations that now exist in code.

## Scope

- Archive the native executor fallback behavior implemented in `services/lobster-executor`
- Archive the local development startup fallback in `scripts/dev-all.mjs`
- Archive the runtime boundary for GitHub Pages static deployment
- Record the commit-level history that produced the current implementation

## Out of Scope

- Re-designing the executor API
- Replacing the browser runtime with a server runtime on GitHub Pages
- Adding container-like isolation to native execution
- Changing the existing Mission / Executor callback protocol

## Requirements

### Requirement 1: Executor supports sandbox-compatible real execution fallback

**User Story:** As a developer running WhyBuddy in a sandbox or on a machine without Docker, I want the executor to keep a real execution path instead of hard-failing when Docker is unavailable, so I can still run commands and produce artifacts locally.

#### Acceptance Criteria

1. WHEN `LOBSTER_EXECUTION_MODE=real` and Docker is reachable, THE Executor SHALL continue to use `DockerRunner`
2. WHEN `LOBSTER_EXECUTION_MODE=real` and Docker is unreachable, THE Executor SHALL fall back to `native` execution instead of exiting the process
3. THE Executor SHALL support `executionMode` values `"mock" | "real" | "native"`
4. THE Native execution path SHALL continue to emit executor events, write logs, and persist `result.json`
5. THE Native execution path SHALL remain compatible with the existing callback/event protocol used by the server

### Requirement 2: Local dev startup prefers a usable execution path

**User Story:** As a developer starting the full stack locally with `npm run dev:all`, I want startup to automatically choose the best available executor mode for my machine, so the stack keeps running even when Docker is missing or stopped.

#### Acceptance Criteria

1. WHEN `npm run dev:all` starts and Docker is reachable, THE startup script SHALL pass `LOBSTER_EXECUTION_MODE=real`
2. WHEN `npm run dev:all` starts and Docker is not reachable, THE startup script SHALL pass `LOBSTER_EXECUTION_MODE=native`
3. WHEN the developer explicitly sets `LOBSTER_EXECUTION_MODE=mock`, THE startup script SHALL preserve `mock`
4. WHEN the developer explicitly sets `LOBSTER_EXECUTION_MODE=native`, THE startup script SHALL preserve `native`
5. THE startup script SHALL log a clear warning when it falls back away from Docker-backed execution

### Requirement 3: GitHub Pages stays in browser runtime only

**User Story:** As a maintainer documenting deployment behavior, I want the static GitHub Pages build to have an explicit runtime boundary, so people do not confuse browser preview mode with server-side executor behavior.

#### Acceptance Criteria

1. WHEN the app is built for GitHub Pages, THE frontend SHALL disable Advanced Runtime
2. WHEN the app runs on GitHub Pages, THE runtime mode SHALL stay in `frontend`
3. WHEN API requests are unavailable in Frontend Mode, THE client SHALL degrade to browser preview/demo behavior instead of attempting executor-based real execution
4. THE GitHub Pages deployment SHALL NOT be described as using `real`, `native`, or `mock` executor modes, because no executor process exists there

### Requirement 4: Implementation history is archived with commit traceability

**User Story:** As a collaborator returning to this area later, I want a concise archive of which commits introduced which parts of the behavior, so I can understand the code evolution without replaying the whole branch.

#### Acceptance Criteria

1. THE spec SHALL record the six non-merge commits from `trae/solo-agent-ENNSlg`
2. THE spec SHALL record the follow-up local commits that improved local dev startup fallback and shutdown behavior
3. THE archive SHALL distinguish between executor runtime changes, local dev workflow changes, and static deployment constraints
