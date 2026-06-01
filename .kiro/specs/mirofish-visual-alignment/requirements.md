# Requirements Document

## Introduction

本 spec 定义一套对齐 MiroFish 极简视觉风格的设计令牌体系与迁移路径。MiroFish 的视觉 DNA 以纯黑白 + 单色强调、无圆角无阴影、高信息密度、等宽字体度量为核心特征，与 whybuddy 当前的 OKLCH 多色系 + 大圆角 + 重阴影 + spring 动效风格存在显著差距。

本 spec 的范围是：
1. 定义一套 "MiroFish-aligned" CSS 变量令牌集（颜色、间距、排版、边框）
2. 以 AutopilotRoutePage 内的 2D cockpit 内容区域（main content grid、right rail、left content）为首个迁移目标；Scene3D、HoloDrawer 外壳和 mobile drawer shell 不在迁移范围内
3. 建立可渐进采用的 CSS 变量覆盖机制
4. 不触碰 3D 场景、不全局移除 framer-motion、不重写所有组件

**明确排除（Out of Scope）：**
- 字体文件管理（@font-face 声明、woff2 托管、延迟字体加载）不在本 spec 范围内。字体令牌通过别名引用现有项目 CSS 变量实现。

## Glossary

- **Design_Token_Set**: 一组以 CSS 自定义属性（`--mf-*` 前缀）定义的颜色、间距、排版和边框变量集合，作为 MiroFish 视觉风格的单一真相源
- **AutopilotRoutePage**: `client/src/pages/autopilot/AutopilotRoutePage.tsx`，SPEC-FIRST blueprint cockpit 的主页面组件，本 spec 的首个迁移目标
- **Migration_Scope**: 指定哪些组件和页面应用 MiroFish 令牌覆盖的边界声明
- **Progressive_Adoption**: 通过 CSS 变量层叠和作用域选择器，允许页面逐步从旧令牌切换到 MiroFish 令牌，而不需要一次性全量替换
- **MiroFish_Theme_Layer**: 一个可选的 CSS 层（`@layer mirofish`），包含所有 MiroFish 对齐的变量覆盖和基础样式规则
- **Accent_Color**: MiroFish 设计系统中唯一的强调色 `#FF4500`（橙红），用于交互元素高亮和状态指示
- **Border_Style**: MiroFish 统一边框规范：`1px solid #E5E5E5`，无阴影，无圆角或最大 2px 圆角
- **Typography_Stack**: MiroFish 字体栈：DM Sans / Noto Sans SC（标题，weight 500）、JetBrains Mono（标签/代码，weight 700）、Noto Sans SC（中文正文）
- **Spacing_Scale**: MiroFish 间距体系：大块间距 60-80px，紧凑元素间距 15-20px，最大内容宽度 1400px 居中

## Requirements

### Requirement 1: MiroFish Design Token Set Definition

**User Story:** As a developer, I want a centralized MiroFish-aligned design token set defined as CSS custom properties, so that I can consistently apply the MiroFish visual style across migrated components.

#### Acceptance Criteria

1. THE Design_Token_Set SHALL define color tokens limited to `--mf-color-bg` (#FFFFFF), `--mf-color-fg` (#000000), `--mf-color-accent` (#FF4500), and `--mf-color-border` (#E5E5E5)
2. THE Design_Token_Set SHALL define typography tokens including `--mf-font-title` (DM Sans / Noto Sans SC), `--mf-font-mono` (JetBrains Mono), `--mf-font-body` (Noto Sans SC), `--mf-title-size` (4.5rem), `--mf-title-weight` (500), `--mf-title-spacing` (0), and `--mf-mono-weight` (700)
3. THE Design_Token_Set SHALL define spacing tokens including `--mf-gap-section` (60px-80px), `--mf-gap-element` (15px-20px), and `--mf-max-width` (1400px)
4. THE Design_Token_Set SHALL define border tokens including `--mf-border` (1px solid #E5E5E5), `--mf-radius` (0px or 2px maximum), and `--mf-shadow` (none)
5. THE Design_Token_Set SHALL be defined in a single CSS file at `client/src/styles/mirofish-tokens.css`
6. THE Design_Token_Set SHALL use the `--mf-` prefix namespace to avoid collision with existing OKLCH design tokens

### Requirement 2: MiroFish Theme Layer Architecture

**User Story:** As a developer, I want a CSS layer mechanism that allows MiroFish tokens to override existing styles within a scoped boundary, so that I can progressively migrate pages without breaking unmigrated components.

#### Acceptance Criteria

1. THE MiroFish_Theme_Layer SHALL be declared as a CSS cascade layer using `@layer mirofish`
2. THE MiroFish_Theme_Layer SHALL activate only within elements carrying a `data-theme="mirofish"` attribute
3. WHEN a component is inside a `[data-theme="mirofish"]` scope, THE MiroFish_Theme_Layer SHALL override border-radius to `var(--mf-radius)` targeting ONLY named surface classes (`.glass-panel`, `.glass-panel-strong`, `.studio-surface`, `.workspace-panel`) and explicit `data-mf-*` attribute selectors (`[data-mf-surface]`, `[data-mf-card]`, `[data-mf-button="primary"]`). NO wildcard selectors like `[class*="rounded-"]` or `[class*="shadow-"]` SHALL be used.
4. WHEN a component is inside a `[data-theme="mirofish"]` scope, THE MiroFish_Theme_Layer SHALL override box-shadow and backdrop-filter targeting ONLY named surface classes (`.glass-panel`, `.glass-panel-strong`, `.studio-surface`, `.workspace-panel`) and explicit `data-mf-*` attribute selectors (`[data-mf-surface]`, `[data-mf-card]`, `[data-mf-button="primary"]`). NO wildcard selectors like `[class*="shadow-"]` or `[class*="backdrop-"]` SHALL be used.
5. WHEN a component is outside a `[data-theme="mirofish"]` scope, THE MiroFish_Theme_Layer SHALL NOT alter the component's existing styles
6. THE MiroFish_Theme_Layer SHALL be importable as a standalone CSS file without requiring changes to the Tailwind configuration

### Requirement 3: Typography Migration for AutopilotRoutePage

**User Story:** As a user, I want the AutopilotRoutePage to use the MiroFish typography stack, so that the cockpit page has a clean, professional, high-density information display.

#### Acceptance Criteria

1. WHEN the AutopilotRoutePage is rendered, THE Typography_Stack SHALL apply DM Sans / Noto Sans SC at weight 500 to all heading elements within the page
2. WHEN the AutopilotRoutePage is rendered, THE Typography_Stack SHALL apply JetBrains Mono at weight 700 to all metric labels, status indicators, and code-like content
3. WHEN the AutopilotRoutePage is rendered, THE Typography_Stack SHALL apply Noto Sans SC to Chinese body text content
4. WHEN an opted-in MiroFish-aware component within the 2D cockpit scope is migrated, THE Typography_Stack SHALL avoid `font-black` (weight 900) and use the appropriate MiroFish weight instead (500 for titles, 700 for mono labels). Broader typography cleanup beyond migrated components is out of MVP scope.
5. THE Typography_Stack SHALL alias to existing project CSS variables: `--mf-font-title: var(--font-display)`, `--mf-font-mono: var(--font-mono)`, `--mf-font-body: "Noto Sans SC", var(--font-body)`. Font file management (@font-face, woff2 hosting) is out of scope for this spec.

### Requirement 4: Border and Shadow Migration for AutopilotRoutePage

**User Story:** As a user, I want the AutopilotRoutePage to use MiroFish's flat border style without shadows or large rounded corners, so that the interface feels clean and information-dense.

#### Acceptance Criteria

1. WHEN the AutopilotRoutePage is rendered within the MiroFish theme scope, THE Border_Style SHALL override border-radius to a maximum of 2px via CSS layer rules targeting named surface classes (`.glass-panel`, `.glass-panel-strong`, `.studio-surface`, `.workspace-panel`) and explicit `data-mf-*` attribute selectors (`[data-mf-surface]`, `[data-mf-card]`). NO wildcard class selectors like `[class*="rounded-"]` SHALL be used.
2. WHEN the AutopilotRoutePage is rendered within the MiroFish theme scope, THE Border_Style SHALL remove box-shadow and backdrop-blur via CSS layer rules targeting named surface classes (`.glass-panel`, `.glass-panel-strong`, `.studio-surface`, `.workspace-panel`) and explicit `data-mf-*` attribute selectors (`[data-mf-surface]`, `[data-mf-card]`). NO wildcard class selectors like `[class*="shadow-"]` or `[class*="backdrop-"]` SHALL be used.
3. WHEN the AutopilotRoutePage is rendered within the MiroFish theme scope, THE Border_Style SHALL apply `1px solid var(--mf-color-border)` as the uniform border for all opted-in card, panel, and container elements targeted by named surface classes or explicit `data-mf-*` attributes
4. IF a component within AutopilotRoutePage uses `bg-gradient-*` or gradient backgrounds, THEN THE Border_Style SHALL replace the gradient with a flat `var(--mf-color-bg)` background

### Requirement 5: Color Palette Migration for AutopilotRoutePage

**User Story:** As a user, I want the AutopilotRoutePage to use MiroFish's monochrome + single accent color palette, so that the interface is visually cohesive and distraction-free.

#### Acceptance Criteria

1. WHEN the AutopilotRoutePage is rendered within the MiroFish theme scope, THE Design_Token_Set SHALL map all background colors to `var(--mf-color-bg)` (#FFFFFF)
2. WHEN the AutopilotRoutePage is rendered within the MiroFish theme scope, THE Design_Token_Set SHALL map all text colors to `var(--mf-color-fg)` (#000000) with opacity variants for secondary text (opacity 0.6) and tertiary text (opacity 0.4)
3. WHEN the AutopilotRoutePage is rendered within the MiroFish theme scope, THE Design_Token_Set SHALL map all interactive highlight colors (active states, selected items, primary buttons) to `var(--mf-color-accent)` (#FF4500)
4. WHEN the AutopilotRoutePage is rendered within the MiroFish theme scope, THE Design_Token_Set SHALL replace multi-color status indicators (emerald/amber/rose) with monochrome indicators using the `■` character and opacity differentiation
5. THE Design_Token_Set SHALL NOT use gradients, OKLCH color functions, or more than the three defined colors (black, white, accent) within the MiroFish theme scope

### Requirement 6: Spacing and Layout Migration for AutopilotRoutePage

**User Story:** As a user, I want the AutopilotRoutePage to use MiroFish's spacing system with large section gaps and tight element gaps, so that the information hierarchy is clear and the layout feels spacious yet dense where it matters.

#### Acceptance Criteria

1. WHEN the AutopilotRoutePage is rendered within the MiroFish theme scope, THE Spacing_Scale SHALL apply 60px-80px gaps between major page sections (header, workflow steps, content area, console)
2. WHEN the AutopilotRoutePage is rendered within the MiroFish theme scope, THE Spacing_Scale SHALL apply 15px-20px gaps between sibling elements within a section (cards, list items, form fields)
3. WHEN the AutopilotRoutePage is rendered within the MiroFish theme scope, THE Spacing_Scale SHALL constrain the main content area to a maximum width of 1400px with horizontal centering
4. WHEN the AutopilotRoutePage is rendered within the MiroFish theme scope, THE Spacing_Scale SHALL use full-width black background buttons with monospace font for primary action buttons

### Requirement 7: Animation Reduction for AutopilotRoutePage

**User Story:** As a user, I want the AutopilotRoutePage to use minimal animation consistent with MiroFish's restrained motion philosophy, so that the interface feels stable and professional rather than playful.

#### Acceptance Criteria

1. WHEN the AutopilotRoutePage is rendered within the MiroFish theme scope, THE AutopilotRoutePage SHALL retain only cursor blink animations, hover color transitions, and subtle `translateY(-2px)` button hover effects
2. WHEN the AutopilotRoutePage is rendered within the MiroFish theme scope, THE AutopilotRoutePage SHALL disable framer-motion spring animations for page transitions, replacing them with instant or near-instant transitions (duration 0ms-50ms)
3. WHEN the AutopilotRoutePage is rendered within the MiroFish theme scope, THE AutopilotRoutePage SHALL remove `AnimatePresence` wrapper animations from content panels
4. IF the user has `prefers-reduced-motion: reduce` set, THEN THE AutopilotRoutePage SHALL disable all remaining animations regardless of theme scope

### Requirement 8: Component Style Overrides for AutopilotRoutePage

**User Story:** As a developer, I want specific component-level style overrides for the AutopilotRoutePage's key UI elements, so that they match MiroFish's component patterns without requiring component rewrites.

#### Acceptance Criteria

1. WHEN the MetricBox component is rendered within the MiroFish theme scope, THE MetricBox SHALL render with `1px solid var(--mf-color-border)`, no border-radius, no shadow, monospace font for the value, and uppercase 10px tracking-wide label
2. WHEN the ApiErrorNotice component is rendered within the MiroFish theme scope, THE ApiErrorNotice SHALL render with a black left border (4px), white background, and black text instead of the rose color scheme
3. WHEN the AutopilotLanguageSwitch component is rendered within the MiroFish theme scope, THE AutopilotLanguageSwitch SHALL render active state as full black background with white monospace text, and inactive state as transparent with black text
4. WHEN the FlowStep indicators are rendered within the MiroFish theme scope, THE FlowStep indicators SHALL use `■` (filled square) for completed/active states and `□` (empty square) for waiting/blocked states instead of colored circle icons. IF FlowStep indicators are not currently a separate component, they SHALL be extracted into a `FlowStepIndicator` component (or equivalent inline conditional) before applying the MiroFish variant.
5. WHEN primary action buttons are rendered within the MiroFish theme scope, THE buttons SHALL render as full-width, black background, white monospace text, no border-radius, with `translateY(-2px)` on hover as the only motion effect

### Requirement 9: Font Token Aliasing Strategy

**User Story:** As a developer, I want MiroFish font tokens to alias to existing project CSS variables, so that the typography stack works without introducing font file management complexity.

#### Acceptance Criteria

1. THE Design_Token_Set SHALL define font tokens as aliases to existing project CSS variables: `--mf-font-title: var(--font-display)`, `--mf-font-mono: var(--font-mono)`, `--mf-font-body: "Noto Sans SC", var(--font-body)`
2. THE Design_Token_Set SHALL NOT include any `@font-face` declarations, woff2 file references, or deferred font loading logic
3. IF Noto Sans SC is not available on the user's system, THEN THE Typography_Stack SHALL fall back to `var(--font-body)` without visual breakage
4. THE Typography_Stack SHALL NOT introduce any font file hosting, CDN imports, or Google Fonts links. Font file management is a separate concern outside this spec's scope.

### Requirement 10: Migration Boundary and Non-Regression

**User Story:** As a developer, I want clear migration boundaries that prevent MiroFish styles from leaking into unmigrated components, so that the progressive adoption does not cause visual regressions.

#### Acceptance Criteria

1. THE Migration_Scope SHALL limit MiroFish theme application to the 2D cockpit content area within AutopilotRoutePage (main content grid, right rail, left content). Scene3D, HoloDrawer outer shell, and mobile drawer shell remain outside the provider.
2. THE Migration_Scope SHALL NOT apply MiroFish styles to the 3D Scene (Scene3D), HoloDock, HoloDrawer, or any Three.js components
3. THE Migration_Scope SHALL NOT remove or modify framer-motion imports in components outside the AutopilotRoutePage
4. WHEN a child component of AutopilotRoutePage is also used in non-MiroFish pages, THE Migration_Scope SHALL ensure the component respects the nearest `data-theme` ancestor to determine its styling
5. THE Migration_Scope SHALL provide a `useMirofishTheme()` hook that returns whether the current component is within a MiroFish theme scope, enabling conditional style logic in shared components. The hook is Context-based only. No DOM fallback hook (`useMirofishThemeDOM`) exists.
6. THE MirofishThemeProvider SHALL default to `enabled=false`. AutopilotRoutePage explicitly passes `enabled` to opt in. WHEN `enabled` is false, no `data-theme` attribute SHALL be rendered and no wrapper `<div>` SHALL be added to the DOM.
7. WHEN the MirofishThemeProvider is disabled (default), THE provider SHALL render children directly without any wrapper element, ensuring zero DOM changes in non-MiroFish contexts.
