---
inclusion: manual
---

# Autopilot Five-Spec Series Closure - 2026-05-24

## Scope

This steering record closes the current five-spec Autopilot series as one bounded delivery track:

- `autopilot-asset-staleness-model`
- `autopilot-replan-and-branch-action`
- `autopilot-stage-edit-mode`
- `autopilot-stage-version-history`
- `autopilot-stage-state-coordination`

## Closure Rule

The five specs above are now treated as a completed series for architecture and requirement evolution purposes.

Future expansion SHALL be started through a new spec series. Future work SHALL NOT back-edit the requirements, task intent, or architectural boundaries of this five-spec series to introduce new scope.

## Remaining Gates

Any remaining unchecked items in the five `tasks.md` files are verification, PR checklist, or manual/browser closure gates. They do not reopen the series scope and should be closed by evidence, not by changing the spec requirements.

## Boundaries That Stay Locked

- Asset staleness remains a downstream artifact invalidation model, not a persistence or socket layer.
- Replan and branch actions remain explicit user-triggered flows, not background auto-branching.
- Stage edit mode remains page-one inline correction plus downstream stale marking, not a full undo stack.
- Version history remains a read-oriented family view with active-job switching, not a backend mutation model.
- Stage state coordination remains a frontend coordination layer, not a backend job-stage writer.
