# Requirements Document

## Introduction

`AutopilotRightRail.tsx` 在 fabric 阶段（`currentStage === "fabric"`）的 5 个子阶段
（`effect_preview` / `prompt_package` / `runtime_capability` / `engineering_handoff` /
`artifact_memory`）当前并不渲染对应的 `panels/*Panel.tsx`，而是统一走通用
`ActiveNodeContent`（`AgentReasoningSubTimeline` + `deriveSubStageSummary` 摘要 +
`timeline-confirm-advance` 按钮）。同时 `mapSubStageToStageIndex` 把这 5 个子阶段折
叠到同一个视觉 STEP 06 · 效果预览，于是当 `effect_preview → prompt_packaging` 自动
推进触发时，会出现"标题：效果预览 / 内容：POST /api/blueprint/prompt-packages"的
错位现象。

本 spec 不重做这套折叠 5-in-1 视觉，只做四件事：

1. 让 `activeSubStage` 在 fabric 阶段决定**实际渲染的产物面板**：每个子阶段挂自身
   panel（`AgentCrewFabricPanel` / `EffectPreviewPanel` / `PromptPackagePanel` /
   `RuntimeCapabilityPanel` / `EngineeringHandoffPanel` / `ArtifactMemoryPanel`），
   `spec_tree` 仍由现有 `StreamingDocRenderer` 主分支独占。
2. 关闭 `effect_preview → prompt_packaging` 的自动推进；用户进入效果预览不再被
   自动跳到下一步，必须点击 footer CTA 经 `forceAdvance` 才走。其它两条
   `spec_docs → effect_preview` / `prompt_packaging → engineering_landing` 自动推进
   保持不变（不扩大爆炸半径）。
3. 删除 `ActiveNodeContent` 内部的 `timeline-confirm-advance` 按钮；保留
   `StageViewport.cta` 作为唯一前进入口，避免重复 CTA。
4. 把 `EffectPreviewPanel` 的"已接受文档"过滤口径与"进入效果预演"按钮的
   `includeDrafts: true` 对齐：从 `status === "accepted"` 改为 `status !== "rejected"`，
   并把 UI 上"N 份已接受文档"措辞改为"N 份可用文档"。

## Glossary

- **Fabric_Sub_Stage**：`AutopilotRailSubStage` 中的 7 个子阶段
  `agent_crew_fabric / spec_tree / effect_preview / prompt_package /
  runtime_capability / engineering_handoff / artifact_memory`。
- **Fabric_Panel_For_Sub_Stage**：每个 Fabric_Sub_Stage 对应的 canonical panel
  组件，已在 `client/src/pages/autopilot/right-rail/panels/index.ts` 命名导出。
- **STEP_06_Folded_Group**：`mapSubStageToStageIndex` 把
  `effect_preview / prompt_package / runtime_capability / engineering_handoff /
  artifact_memory` 5 个子阶段折叠到 STEP_ORDER 中同一个 `effect_preview` 位置；
  这是视觉折叠，不是数据折叠。
- **Active_Sub_Stage**：`resolveRailSubStage(...)` 解析出的当前 fabric 子阶段。
- **Auto_Advance_From_Effect_Preview**：`use-auto-advance.ts` 中
  `(stage === "effect_preview" || "preview") && status === "completed"` 触发的
  `generatePromptPackages()` 推进路径。
- **Active_Node_Content**：`AutopilotRightRail.tsx` 内部组件，当前在非
  `spec_tree / spec_documents` 分支时挂载，作为 fallback 渲染体；包含一个内置的
  `data-testid="timeline-confirm-advance"` 按钮。
- **Stage_Viewport_CTA**：`<StageViewport>` 三段式 footer 中的 `<StageCTA>`，由
  `manualAdvanceAction` 决定标签与目标阶段。
- **Preview_Source_Documents**：`EffectPreviewPanel` 用于驱动 `previewNodes` /
  `canGenerate` / "N 份可用文档" 的文档集合。

## Requirements

### Requirement 1: Active_Sub_Stage 决定渲染的 Fabric_Panel_For_Sub_Stage

**User Story:** 作为查看 fabric 阶段的用户，我希望进入哪一个产物子阶段就看到对应
产物面板的真实内容（效果预览看预演详情、提示词包看 prompt 列表），不再看到通用
"POST /api/... + AgentReasoningSubTimeline 列表"的占位页。

#### Acceptance Criteria

1. WHEN `currentStage === "fabric"` AND `Active_Sub_Stage === "effect_preview"`,
   THE Right_Rail SHALL render `EffectPreviewPanel` 作为 `<StageViewport>` 的主
   内容，并 NOT 渲染 `Active_Node_Content`。
2. WHEN `currentStage === "fabric"` AND `Active_Sub_Stage === "prompt_package"`,
   THE Right_Rail SHALL render `PromptPackagePanel` 作为主内容，并 NOT 渲染
   `Active_Node_Content`。
3. WHEN `currentStage === "fabric"` AND
   `Active_Sub_Stage === "runtime_capability"`, THE Right_Rail SHALL render
   `RuntimeCapabilityPanel` 作为主内容。
4. WHEN `currentStage === "fabric"` AND
   `Active_Sub_Stage === "engineering_handoff"`, THE Right_Rail SHALL render
   `EngineeringHandoffPanel` 作为主内容。
5. WHEN `currentStage === "fabric"` AND
   `Active_Sub_Stage === "artifact_memory"`, THE Right_Rail SHALL render
   `ArtifactMemoryPanel` 作为主内容。
6. WHEN `currentStage === "fabric"` AND
   `Active_Sub_Stage === "agent_crew_fabric"`, THE Right_Rail SHALL render
   `AgentCrewFabricPanel` 作为主内容。
7. THE Right_Rail SHALL keep `spec_tree` / `spec_documents` 既有
   `StreamingDocRenderer` 主分支不变，本需求不影响 spec 阶段。
8. THE Right_Rail SHALL keep `mapSubStageToStageIndex` 的 STEP_06_Folded_Group
   折叠行为不变（标题仍可能保留"STEP 06 · 效果预览"），需求 1 只决定**内容**
   按 sub-stage 分流，**不**重做视觉 step 划分。
9. THE 6 个 fabric panels SHALL NOT 自行订阅 `useBlueprintRealtimeStore`、`socket`
   或修改全局 store；其依赖只能来自 `AutopilotRightRailProps` props 传入（已是
   现状，本需求不破坏）。

### Requirement 2: Auto_Advance_From_Effect_Preview 仅手动触发

**User Story:** 作为正在评审效果预演产物的用户，我希望系统不要在 effect_preview
变 completed 的瞬间自动跳到 prompt_packaging；我得有时间看预演内容，再点 CTA
进入下一步。

#### Acceptance Criteria

1. WHEN `job.stage === "effect_preview"` OR `job.stage === "preview"` AND
   `job.status === "completed"`, THE `useAutoAdvance` hook SHALL NOT 自动调用
   `generateBlueprintPromptPackages(...)`。
2. WHEN 用户点击 `Stage_Viewport_CTA` 而 `job.stage === "effect_preview"` 时,
   THE `forceAdvance()` SHALL 调用 `generateBlueprintPromptPackages(...)`，沿用
   既有手动推进契约（`includeDrafts: true, includePreviewDrafts: true`）。
3. THE `useAutoAdvance` hook SHALL 保留 `spec_docs → effect_preview` 与
   `prompt_packaging → engineering_landing` 的自动推进路径不变（与本需求无关）。
4. THE `spec_tree` 阶段的"必须由用户手动 `forceAdvance` / `Stage_Viewport_CTA`
   触发，不能自动跳过"既有契约（`autopilot-streaming-experience` 需求 5）SHALL
   不受影响；本 spec 不再把该契约绑定到已删除的 `timeline-confirm-advance`
   legacy testId。
5. THE 既有 `use-auto-advance.spec-tree.test.ts` 与 `use-auto-advance.test.ts`
   测试套件 SHALL 持续通过；新增的"effect_preview 不再自动推进"断言 SHALL 与
   既有断言并存而非替换。

### Requirement 3: 去除重复"继续下一步"按钮

**User Story:** 作为查看右栏的用户，我希望同一个阶段卡片里只看到一个"继续下一步"
按钮，不要在内容区里再出现一个内嵌按钮。

#### Acceptance Criteria

1. THE `Active_Node_Content` 内部 SHALL NOT 再渲染 `data-testid="timeline-confirm-advance"`
   按钮；该按钮整体删除。
2. THE `Stage_Viewport_CTA` 仍然作为唯一的"继续下一步" CTA 存在，不变。
3. SINCE 需求 1 已经把 fabric 5 个产物子阶段从 `Active_Node_Content` 移到各自
   panel，这条删除 SHALL 不影响已被替换为 panel 的渲染路径；仅影响当前还在使用
   `Active_Node_Content` 的回退分支（如 `agent_crew_fabric` 的 dev fallback、
   异常 sub-stage 兜底）。
4. 既有 `autopilot-right-rail-cards.test.tsx` 中针对
   `data-testid="timeline-confirm-advance"` 的断言 SHALL 同步迁移到
   `data-testid="autopilot-stage-continue-button"`（即 `StageCTA` 的现有 testId），
   保持"用户能看到一个继续按钮"的覆盖力度不下降。

### Requirement 4: EffectPreviewPanel 文档口径与 includeDrafts 对齐

**User Story:** 作为点击"进入效果预演"按钮（默认 `includeDrafts: true`）后看到
`EffectPreviewPanel` 的用户，我希望面板里"可用文档"统计、`previewNodes` 选择
源、生成按钮可用性都按"非 rejected"过滤，不再因为只看 accepted 而出现"明明
predviews 已生成却显示 0 份可用文档/不可生成"。

#### Acceptance Criteria

1. THE `EffectPreviewPanel` SHALL 把当前命名 `acceptedDocuments` 重命名为
   `Preview_Source_Documents`，过滤规则从
   `(document.status ?? "draft").toLowerCase() === "accepted"` 改为
   `(document.status ?? "draft").toLowerCase() !== "rejected"`。
2. THE `EffectPreviewPanel` 中所有原本依赖 `acceptedDocuments` 的派生
   （`previewNodeIds` / `previewNodes` 默认选中、`canGenerate`、生成按钮
   `disabled`、底部统计 Badge "N 份已接受文档"）SHALL 一律改为依赖
   `Preview_Source_Documents`。
3. WHEN `EffectPreviewPanel` 调用 `generateBlueprintEffectPreview(...)`, THE
   request options SHALL use `includeDrafts: true` so the enabled UI state and
   server-side generation filter match the same Preview_Source_Documents
   contract.
4. THE 底部 Badge 文案 SHALL 从"N 份已接受文档"/"N accepted documents"改为
   "N 份可用文档"/"N usable documents"，去掉"已接受"的隐含约束。
5. THE `EffectPreviewPanel` SHALL NOT 改变其它显示文档详情时的 status 标签
   （仍然展示 draft / reviewing / accepted），本需求只改"是否纳入来源池"的过滤。
6. WHEN 文档全部为 `rejected` 状态时, THE `Preview_Source_Documents` SHALL 为空
   数组，`canGenerate` SHALL 为 `false`，与现有"无文档时不可生成"语义一致。
7. 既有 `EffectPreviewPanel.image-integration.test.tsx` /
   `EffectPreviewPanel.settings-integration.test.tsx` /
   `EffectPreviewPanel.production-snapshot.test.tsx` SHALL 持续通过；新增的
   "draft 文档也算可用文档"用例 SHALL 与既有 fixture 共存。

## Non-Functional Requirements

### NFR-1：测试形态约束

1. 仅采用 example-based vitest 用例；不引入 PBT。
2. 仅采用 `react-dom/server.renderToStaticMarkup` + `vi.mock` 风格组件测试，与
   仓库既有 right-rail 测试一致；不引入 `@testing-library/react` / jsdom /
   happy-dom。

### NFR-2：测试基线

1. 实现 SHALL 在改动后保持 `node --run check` 退出 0。
2. 实现 SHALL 在改动后保持既有 `client/src/pages/autopilot/right-rail/__tests__/`
   与 `client/src/pages/autopilot/right-rail/panels/__tests__/` 全套测试通过；
   `use-auto-advance.test.ts` / `use-auto-advance.spec-tree.test.ts` 全套通过。
3. 新增至少 4 条断点测试覆盖：
   - **R1**：当 `currentSubStage === "effect_preview"`，右栏渲染 markup 含
     `data-testid="effect-preview-generate-button"`（`EffectPreviewPanel` 入
     口断点），且不含 `data-testid="timeline-confirm-advance"`。
   - **R2**：当 `currentSubStage === "prompt_package"`，右栏渲染 markup 含
     `PromptPackagePanel` 的稳定断点（如 `data-testid` 或顶部标题），且不含
     `data-testid="timeline-confirm-advance"`。
   - **R3**：用 source-level contract test 断言 useEffect 自动推进区不再包含
     effect_preview/preview → prompt_packaging；同时断言 `forceAdvance()` 分支仍保留
     effect_preview/preview → prompt_packaging（手动推进仍可用）。
   - **R4**：`EffectPreviewPanel` 在 documents 全为 `draft` 时，`canGenerate`
     为 `true` 且 Badge 文本是"N 份可用文档"。

### NFR-3：禁止修改的源文件 / 范围

1. SHALL NOT 修改 `panels/EffectPreviewPanel.tsx` 之外的 5 个 fabric panel 内部
   实现（仅在 `AutopilotRightRail.tsx` 内挂载 / 透传 props）。
2. SHALL NOT 改变 `resolveRailSubStage` 既有 switch 表（视觉折叠保持不变是需求 1.8
   的硬约束）。
3. SHALL NOT 修改 server-side `blueprint.ts`、`stage-progress-emitter.ts` 等后端
   代码（本 spec 全部在 client 侧）。
4. SHALL NOT 引入新的 store slice / context / API；现有 props 已经够用。
