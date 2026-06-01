# Implementation Plan

> 严格 example-based 测试，不引入 PBT；仅 SSR + `react-dom/server.renderToStaticMarkup`
> + `vi.mock`，不引入 Testing Library / jsdom / happy-dom。
> `node --run check` 必须保持退出 0。

## Task 1：fabric sub-stage 内容分流（需求 1）

- [x] 1.1 在 `client/src/pages/autopilot/right-rail/AutopilotRightRail.tsx` 内新增
      本地纯函数 `renderFabricSubStageContent(activeSubStage, props)`：穷尽 switch
      6 个 fabric sub-stage（含 `spec_tree` 返回 null 让上游 `StreamingDocRenderer`
      接管），每个 case 返回对应 panel；TypeScript `never` 兜底。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.9_
- [x] 1.2 替换 `<ActiveNodeContent>` 调用点（行 ~1437）：
  - `currentStage === "fabric" && activeSubStage !== undefined` 时走
    `renderFabricSubStageContent`；
  - 保留外层 `<div data-sub-stage-placeholder=... data-timeline-status=...
    aria-current=...>` 包裹，避免破坏 `fabric-dispatch.property.test.tsx` 等回归；
  - 非 fabric 兜底分支保留 `<ActiveNodeContent>`，不改其它语义。
  - _Requirements: 1.8_
- [x] 1.3 新增/扩展 `client/src/pages/autopilot/right-rail/__tests__/autopilot-right-rail-cards.test.tsx`：
      6 例 SSR 渲染，每例断言对应 panel 的稳定 marker 命中、不含
      `data-testid="timeline-confirm-advance"`、仍含
      `data-sub-stage-placeholder="<sub>"`。
  - _Requirements: 1.1–1.6, 3.1, NFR-2.3 R1+R2_

## Task 2：删除 ActiveNodeContent 内嵌"继续下一步"（需求 3）

- [x] 2.1 删除 `AutopilotRightRail.tsx` 内 `ActiveNodeContent` 的
      `<button data-testid="timeline-confirm-advance">...</button>` 块（行 ~599–615）；
      `onConfirmAdvance` prop 保留但不再被消费。
  - _Requirements: 3.1, 3.2, 3.3_
- [x] 2.2 把 `__tests__/autopilot-right-rail-cards.test.tsx` 中所有针对
      `data-testid="timeline-confirm-advance"` 的断言迁移到
      `data-testid="autopilot-stage-continue-button"`；保持 case 数量与覆盖力度。
  - _Requirements: 3.4_
- [x] 2.3 在 Task 1.3 的新测试中补一例：fabric sub-stage 下整段 markup 含
      0 个 `timeline-confirm-advance`、最多 1 个
      `autopilot-stage-continue-button`（仅当 `manualAdvanceAction.type !== "none"`）。
  - _Requirements: 3.1, 3.2, NFR-2.3 R2_

## Task 3：关闭 effect_preview→prompt_packaging 自动推进（需求 2）

- [x] 3.1 删除 `hooks/use-auto-advance.ts` 中
      `(stage === "effect_preview" || stage === "preview") && status === "completed"`
      的 useEffect 自动推进分支；用注释说明：本契约由
      `autopilot-step-06-effect-preview-fix-2026-05-31` 显式锁定为手动。
  - _Requirements: 2.1, 2.5_
- [x] 3.2 保留 `forceAdvance()` 内 `else if (stage === "effect_preview" || ...)`
      手动推进路径；不变更其参数（`includeDrafts: true, includePreviewDrafts: true`）。
  - _Requirements: 2.2_
- [x] 3.3 新增 `hooks/__tests__/use-auto-advance.effect-preview.test.ts`：
  - 采用 source-level contract test，不 mount hook，不引入 Testing Library / jsdom；
  - 断言 useEffect 自动推进区不再包含 effect_preview/preview → prompt_packaging；
  - 断言 `forceAdvance()` 仍保留 effect_preview/preview → prompt_packaging，且参数仍是
    `includeDrafts: true, includePreviewDrafts: true`；
  - 断言 spec_docs→effect_preview 与 prompt_packaging→engineering_landing
    两条自动推进仍存在。
  - _Requirements: 2.1, 2.2, 2.3, 2.5, NFR-2.3 R3_

## Task 4：EffectPreviewPanel 文档来源口径与 includeDrafts 对齐（需求 4）

- [x] 4.1 在 `panels/EffectPreviewPanel.tsx` 把局部变量 `acceptedDocuments`
      重命名为 `previewSourceDocuments`，过滤规则改为
      `(document.status ?? "draft").toLowerCase() !== "rejected"`；下游所有
      引用一并替换；`handleGenerate` 调用 `generateBlueprintEffectPreview` 时同步
      改为 `includeDrafts: true`。
  - _Requirements: 4.1, 4.2, 4.3, 4.6_
- [x] 4.2 把底部 Badge 文案从"N 份已接受文档"/"N accepted documents"改为
      "N 份可用文档"/"N usable documents"；其它 status 标签不动。
  - _Requirements: 4.3, 4.4_
- [x] 4.3 在 `panels/__tests__/EffectPreviewPanel.production-snapshot.test.tsx`
      旁新增一例（或同文件内追加）："documents 全部为 draft" 时
      `data-testid="effect-preview-generate-button"` **不**带 `disabled`，且
      markup 含"份可用文档"字样而不再含"份已接受文档"。
  - _Requirements: 4.6, NFR-2.3 R4_

## Task 5：守门 + 同步既有测试

- [x] 5.1 跑全套 right-rail / panels 测试，逐条修复因 Task 1–4 引入的断言迁移：
  - `autopilot-right-rail-cards.test.tsx`（CTA testId 迁移）；
  - `EffectPreviewPanel.*.test.tsx`（`acceptedDocuments` → `previewSourceDocuments`
    命名引用如有则同步；fixture 多用 accepted 不需要翻转断言）；
  - 检查是否有任何用例靠 `ActiveNodeContent` 在 fabric sub-stage 下渲染来断言，
    若有则迁移到 panel 断点。
  - _Requirements: 全部 + NFR-2.2_
- [x] 5.2 跑 `node --run check`，确认退出 0；不扩大 TypeScript 基线错误数。
  - _Requirements: NFR-2.1_
- [x] 5.3 在 `.kiro/specs/autopilot-streaming-experience/design.md` 末尾追加一节
      「2026-05-31 Step 06 effect_preview 修复」，记录：
  - effect_preview→prompt_packaging 自动推进已被显式关闭，spec_tree
    "必须手动 forceAdvance / StageViewport CTA 触发"契约不受影响；
  - fabric 5-in-1 视觉折叠保留，但内容已改为按 sub-stage 分流到对应 panel；
  - `ActiveNodeContent` 内嵌 `timeline-confirm-advance` 按钮已删；
  - `EffectPreviewPanel` 文档来源口径改为 `!== "rejected"`，与
    `includeDrafts: true` 对齐。
  - _Requirements: spec ⇄ code 同步，全 spec_

## 验证清单

- [x] `node --run check` → exit 0
- [x] `npx vitest run client/src/pages/autopilot/right-rail` → 全绿
- [x] `npx vitest run client/src/pages/autopilot/right-rail/panels` → 全绿
- [x] `npx vitest run client/src/pages/autopilot/right-rail/hooks` → 全绿
- [ ] 截图复现验证：本地 `pnpm run dev:all`，效果预演点击进入后
      - 标题：STEP 06 · 效果预览
      - 内容：`EffectPreviewPanel`（图像/调度/原型）
      - 不再自动跳到 prompt_packaging
      - 只有一个"继续下一步"按钮（`autopilot-stage-continue-button`）
      - 即使 spec 文档全是 draft，也能看到 "N 份可用文档" 且生成按钮可用
