# Autopilot Five-Spec PR Description Checklist - 2026-05-24

This file is the PR description checklist artifact for the five-spec Autopilot closeout. It is intended to be pasted into the GitHub PR body as-is.

## Verification Summary

- [x] `npx tsc --noEmit --pretty false` exits 0.
- [x] Focused client tests pass: 8 files, 103 tests passed, 1 skipped.
- [x] `npm run build:pages` exits 0.
- [x] `docs/autopilot-five-spec-tasks-progress-2026-05-24.svg` parses as XML.
- [x] Local dev services are reachable on ports 3000, 3001, and 3031.
- [x] Reduced-motion queue semantics and sonner reduced-motion CSS are covered by focused tests.

## Spec 1: Asset Staleness Model

- [x] No new socket channel.
- [x] No new persistence layer.
- [x] No new authentication layer.
- [x] No new audit subsystem.
- [x] No new rate limiting layer.

Scope note: the added staleness surface is a pure downstream artifact invalidation/read model around `staleSince`, `invalidatedBy`, `staleArtifactIds`, dependency graph derivation, and the stale-artifacts API.

## Spec 2: Replan and Branch Action

- [x] No new socket channel.
- [x] No new `BlueprintEventName` family.
- [x] No new persistence layer.
- [x] No new authentication layer.
- [x] No new rate limiting layer.

Scope note: this spec adds `replan.triggered` as a job-family event type, not a new event family, and keeps replan actions explicitly user-triggered through the replan route.

## Spec 3: Stage Edit Mode

- [x] No new socket channel.
- [x] No new persistence layer.
- [x] No new authentication layer.
- [x] No new rate limiting layer.
- [x] No cross-mainline rewrite.

Scope note: stage edit stays limited to page-one inline correction, downstream stale marking, and stage-specific regeneration hooks.

## Spec 4: Stage Version History

- [x] Zero backend mutation from the version-history UI.
- [x] No new socket channel.
- [x] No new `BlueprintEventName` family.
- [x] Does not reuse spec 2 or spec 3 UI components as hidden dependencies.

Scope note: family history is a read-oriented family view. Active-job switching remains a frontend-local selection and URL/store coordination concern.

## Spec 5: Stage State Coordination

- [x] Zero backend change for the coordination layer.
- [x] Zero shared contracts change for the coordination layer.
- [x] Zero new endpoint.
- [x] Zero new `BlueprintEventName`.
- [x] Zero new socket channel.
- [x] Does not write backend `job.stage`.

Scope note: coordination remains a frontend-only atomic refresh, transition, toast queue, and consistency layer.

## Remaining Non-PR Gates

- [ ] Version-history dev/manual browser check: create 2 branches, open history, verify family render, switch active, compare view, and 3 replan timeline events.
- [ ] Coordination dev/manual browser check: verify page and stage transition flow under `dev:all`.
