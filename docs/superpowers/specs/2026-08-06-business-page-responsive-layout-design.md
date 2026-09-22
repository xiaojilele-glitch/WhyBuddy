# Business Page Responsive Layout Design

## Goal

Replace the five-slot-only business page scaffold with a backward-compatible
responsive grid contract so workbench, kanban, calendar, and wizard pages can
express real hierarchy instead of converging on the same vertical stack.

## Open-source references

- react-grid-layout/react-grid-layout (MIT): 12-column items, breakpoint
  layouts, larger-breakpoint fallback, bounds correction, and compaction.
- appsmithorg/appsmith (Apache-2.0): separation between layout nodes and widget
  rendering, typed layout kinds, child validation, and fail-open transforms.
- NocoBase and ToolJet are architecture references only because their licensing
  is not suitable for copying implementation into this MIT project.

Reference clones live outside this repository at:

    C:\Users\wangchunji\Documents\codex-references\sliderule-layout

## Decision

Do not add the interactive React Grid Layout runtime. Generated applications
are viewers, not editors, so drag, resize, collision state, and absolute pixel
height are unnecessary.

Use its mature data model with a native CSS Grid renderer. Page layout gains a
grid object containing desktop, tablet, and phone arrays. Each item declares
blockRef plus integer x, y, w, and h values.

The grid has 12 columns on desktop, 8 on tablet, and 4 on phone. The runtime
clamps out-of-bounds items, removes dangling or duplicate references, sorts by
y/x, and vertically compacts items without changing declared width.

Missing breakpoints fall back from phone to tablet to desktop. When grid is
absent, the runtime upgrades the existing five slots into a deterministic
page-kind preset. Existing persisted models improve without a new LLM run.

## Rendering boundaries

- The layout renderer only places block references.
- ExperienceBlockBoundary remains the only component registry entry point.
- The page-kind data view becomes a synthetic page-content grid item instead
  of always being appended after every fixed block.
- Invalid layout data falls back to a deterministic preset and never blanks
  the page.

## Deterministic presets

- workbench: summary above an 8/4 content and activity split.
- kanban: controls above a full-width kanban; activity is supporting content.
- calendar: controls above a wide calendar with an activity rail.
- wizard: workflow/progress above a wide task surface.
- monitor/dashboard: retain freeformOverview ownership.
- phone: one ordered column preserving semantic priority.

## Theme contract

Fixed blocks consume Ant Design or app theme variables instead of hard-coded
white and stone colors. Dark recipes must produce one coherent surface system.

## Validation and tests

TypeScript and Python validate breakpoint names, integer coordinates, positive
sizes, column bounds, existing block references, and one placement per block.
The old slot validation remains active.

Tests cover breakpoint fallback, clamping, deduplication, slot upgrade, phone
ordering, renderer placement, page-content ownership, and Gate rejection.
