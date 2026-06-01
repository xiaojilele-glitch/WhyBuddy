# Design

## Overview

This archive spec captures the current runtime matrix for WhyBuddy after the
sandbox-native executor work and the local `dev:all` fallback refinements.

The implementation now has three clearly different environment paths:

1. **Local machine with Docker**
   - `dev:all` chooses `LOBSTER_EXECUTION_MODE=real`
   - executor uses `DockerRunner`
2. **Local machine without Docker**
   - `dev:all` chooses `LOBSTER_EXECUTION_MODE=native`
   - executor uses `NativeRunner`
3. **GitHub Pages static deployment**
   - frontend is forced into browser runtime / `frontend` mode
   - no server process and no executor process exist

This is important because “no Docker” is no longer a single case:

- local no-Docker can still do real host-process execution via `native`
- GitHub Pages no-Docker cannot do any executor-backed execution at all

## Runtime Matrix

| Environment | Server | Executor | Effective runtime | Notes |
| --- | --- | --- | --- | --- |
| Local + Docker reachable | yes | yes | `real` | Full Docker-backed execution |
| Local + Docker unreachable | yes | yes | `native` | Host-process execution, still writes logs/artifacts |
| Local + explicit `mock` | yes | yes | `mock` | Pure simulated executor path |
| GitHub Pages static build | no | no | `frontend` browser runtime | No Advanced Runtime, no executor |

## Code Mapping

### 1. Executor-side native fallback

Implemented in:

- `services/lobster-executor/src/config.ts`
- `services/lobster-executor/src/index.ts`
- `services/lobster-executor/src/runner.ts`
- `services/lobster-executor/src/native-runner.ts`
- `services/lobster-executor/src/app.ts`
- `services/lobster-executor/src/service.ts`

Current behavior:

- `readLobsterExecutorConfig()` recognizes `mock`, `real`, and `native`
- `startLobsterExecutorServer()` probes Docker only when requested mode is `real`
- if Docker ping fails, effective mode changes from `real` to `native`
- `createJobRunner()` dispatches to `MockRunner`, `DockerRunner`, or `NativeRunner`

### 2. Local startup fallback

Implemented in:

- `scripts/dev-all.mjs`
- `scripts/dev-stop.mjs`

Current behavior:

- `dev:all` probes Docker before launching child processes
- explicit `mock` or `native` settings are preserved
- unresolved `real` mode falls back to `native`
- Windows startup and shutdown behavior were strengthened so `vite`, `tsx`, and executor processes are cleaned up more reliably

### 3. GitHub Pages browser-only runtime

Implemented in:

- `vite.config.ts`
- `client/src/lib/deploy-target.ts`
- `client/src/lib/store.ts`
- `client/src/lib/api-client.ts`
- `client/src/runtime/browser-runtime.ts`

Current behavior:

- GitHub Pages build injects `__GITHUB_PAGES__ = true`
- `CAN_USE_ADVANCED_RUNTIME` becomes `false`
- app store forces `runtimeMode = "frontend"`
- the browser runtime is used instead of server/executor flow
- API failures degrade into browser preview/demo behavior rather than executor-backed execution

## Why `native` was needed

Before this change, the executor’s `real` mode assumed Docker was mandatory.
That worked on fully provisioned local machines, but failed in sandbox environments.

The native path solves the “no Docker, but still can run local processes” case:

- commands are spawned directly on the host
- logs stream into `executor.log`
- result metadata is written to `result.json`
- callback/event semantics are preserved

This is intentionally different from `mock`:

- `mock` simulates execution
- `native` performs actual host-process execution

## Why GitHub Pages is still different

GitHub Pages is a static deployment target, so it cannot host:

- Express server
- Socket server
- Lobster executor
- Docker or host-process execution service

Because of that, Pages cannot use:

- `real`
- `native`
- `mock` executor modes

Instead, it uses the browser runtime and browser-local persistence only.

## Archived Commit Map

### Original branch work: `trae/solo-agent-ENNSlg`

1. `189c7fb`
   - dependency lockfile update
   - prepared the branch workspace for executor changes
2. `f740576`
   - added sandbox native executor design doc
3. `2b73e71`
   - added sandbox native executor implementation plan
4. `f44aa0f`
   - introduced `NativeRunner`
   - extended executor config to `mock | real | native`
   - added Docker-to-native fallback in executor startup
   - added tests around native mode and fallback behavior
5. `ade2694`
   - adjusted `scripts/dev-all.mjs` startup path and startup timeout for sandbox stability
6. `9511dee`
   - added `client/public/executor-flow.svg` to visualize the execution pipeline

### Local follow-up commits on `main`

1. `ad06e1e`
   - improved `dev:all` startup fallback and shutdown handling
   - made local startup resilient when Docker is down
   - improved Windows child-process cleanup
2. `81a2a44`
   - changed local `dev:all` fallback from `mock` to `native`
   - aligned README with real local behavior

## Relationship to existing specs

- This archive builds on `lobster-executor-real`
- It does not replace the original Docker executor spec
- It adds the missing environment-compatibility layer that became necessary once sandbox execution and local no-Docker development became a real use case
