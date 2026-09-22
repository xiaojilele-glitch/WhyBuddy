# Ant Design Pro Workbench Surfaces Design

## Problem

Business pages currently describe blocks and grid placement, but not the user's
operational mode. Filters, metrics, the primary entity table, activity, and a
workflow timeline are rendered as independent peers. Pages with different jobs
therefore converge on the same visual template.

## Reference Architecture

The implementation follows the composition used by Ant Design Pro Components
and Ant Design Pro: a page container owns one primary work surface, while
search, toolbar actions, column settings, selection, pagination, editing, and
record details belong to that surface. Supporting blocks remain secondary.

The compatible dependency is `@ant-design/pro-components@2.8.10`; version 3
requires Ant Design 6, while this repository uses Ant Design 5.29.3.

## Schema Contract

`page.surface` is an optional object with two controlled fields:

- `type`: `table`, `editable-table`, `split-list`, or `queue`.
- `density`: `compact`, `default`, or `comfortable`.

`kind=kanban` and `kind=calendar` continue to own their domain views. For old
models without `surface`, the runtime deterministically chooses a surface from
the page kind and field semantics. This introduces no additional LLM call.

## Runtime Surfaces

- `table`: ProTable with integrated search, toolbar, column settings,
  selection, pagination, row actions, and a ProDescriptions detail drawer.
- `editable-table`: EditableProTable for high-frequency operational records.
- `split-list`: ProList master column with ProDescriptions detail pane for
  people, coaches, assets, and other directory-like resources.
- `queue`: ProTable preceded by Segmented status lanes and paired with the
  existing exception/activity rail for follow-up, approval, and reconciliation.

Phone rendering keeps the existing antd-mobile list/detail flow. The surface
contract controls information order but does not load desktop Pro components
into the phone shell.

## Ownership Rules

Each page has exactly one primary entity surface. A DataTable block cannot
repeat the page's primary entity. KPI blocks are optional and compact; workflow
timelines appear after the primary task unless the page is explicitly a wizard.

## Validation And Compatibility

The Python Gate rejects unknown surface types or densities. TypeScript schema
derivation preserves valid declarations and falls back safely for old or invalid
models. Existing kanban, calendar, dashboard, and freeform overview ownership
remain unchanged.

## Acceptance

- Member-like pages render a searchable ProTable with a detail surface.
- Coach/resource pages render a master-detail split surface.
- Check-in or other high-frequency pages can render EditableProTable.
- Renewal/payment review pages render a status queue surface.
- Existing models without `surface` still render deterministically.
- Focused frontend and Python Gate tests, TypeScript, and real PC/phone
  screenshot traversal pass.
