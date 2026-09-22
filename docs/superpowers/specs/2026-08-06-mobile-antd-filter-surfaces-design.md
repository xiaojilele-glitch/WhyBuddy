# Mobile Ant Design Surface Routing

## Goal

Fix the generated Sliderule runtime surfaces shown in the desktop and phone screenshots:

- Desktop `QueryFilter` fields must use the available content width without forcing a sparse two-column layout for a single field.
- Phone experience blocks must render with `antd-mobile`, not desktop Ant Design or Pro Components.

## Design

`ExperienceBlockBoundary` receives an explicit `device` value from `AppRuntimeScreen`. The existing desktop renderer map remains the default. For `phone`, a separate renderer map in `phone-mobile` handles `FilterBar`, `QuickActionPanel`, `WorkflowTimeline`, and `MetricGrid` with `Form`, `Selector`, `Button`, `Card`, `Steps`, `Grid`, and `Statistic` from `antd-mobile`.

The phone filter keeps the existing `PageFilterState` contract and calls the same `onFilterChange` callback. It presents enum fields as `Selector` rows and date range as a compact action that opens an `antd-mobile` `DatePicker`/`Popup` flow. No data or schema contract changes are required.

Desktop `QueryFilter` receives a responsive `colProps` configuration and a constrained form style so fields use full width at narrow surfaces while preserving normal multi-column behavior on wide desktop surfaces.

## Verification

- Renderer contract tests prove phone blocks contain `adm-` classes and do not contain `ant-pro-`/desktop form controls.
- Desktop filter tests prove the responsive column contract is present.
- Typecheck, focused Vitest tests, production build, and a real desktop/mobile browser tour validate the result.
