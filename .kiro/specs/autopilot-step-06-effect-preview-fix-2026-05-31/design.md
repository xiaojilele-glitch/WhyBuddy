# Design Document

## Overview

把 fabric 阶段的右栏从"通用 ActiveNodeContent 一通到底 + 视觉折叠 5-in-1"改成
"视觉折叠保留 + 内容按 sub-stage 分流到 6 个 canonical fabric panels"，同时关掉
`effect_preview → prompt_packaging` 的自动推进，去掉重复 CTA，并把
`EffectPreviewPanel` 的来源文档口径与 `includeDrafts: true` 对齐。

不动后端契约、不动 `panels/*Panel.tsx` 内部实现（除 `EffectPreviewPanel` 一处过滤
口径调整）、不动 `resolveRailSubStage` 与 `mapSubStageToStageIndex`。

## Architecture

### 当前数据流（截图反映的真实路径）

```text
job.stage = prompt_packaging          ← effect_preview→prompt_packaging 自动推进后
       │
       ▼
resolveRailSubStage(...)              ← case "prompt_packaging": return "prompt_package"
  → activeSubStage = "prompt_package"
       │
       ▼
mapSubStageToStageIndex(...)          ← prompt_package 折叠到 effect_preview 视觉位
  → activeStageKey = "effect_preview"
       │
       ▼
StageHeader: STEP 06 · 效果预览       ← 标题来自 activeStageKey
       │
       ▼
非 spec_documents/spec_tree 分支:
  <ActiveNodeContent
    summary={deriveSubStageSummary("prompt_package", ...)}  ← 内容来自 activeSubStage
    onConfirmAdvance={...}
  />
       │
       ▼
ActiveNodeContent 内部:
  - <AgentReasoningSubTimeline />       ← 通用 artifact stream
  - <button data-testid="timeline-confirm-advance" />  ← 重复 CTA #1

外面 StageViewport.cta:
  - <StageCTA testId="autopilot-stage-continue-button" />  ← 重复 CTA #2
```

### 修复后数据流

```text
job.stage = (任何值)
       │
       ▼
resolveRailSubStage(...)              ← 不变
  → activeSubStage = ...
       │
       ▼
mapSubStageToStageIndex(...)          ← 不变（视觉折叠保留）
  → activeStageKey = ...
       │
       ▼
StageHeader 标题：仍可能是"STEP 06 · 效果预览"（折叠不变）
       │
       ▼
StageViewport children 分流：
  if activeStageKey === "spec_documents" || "spec_tree":
    → StreamingDocRenderer（不变）
  else if currentStage === "fabric" && activeSubStage 命中：
    → renderFabricPanelForSubStage(activeSubStage, props)
       ├─ "agent_crew_fabric"     → <AgentCrewFabricPanel ... />
       ├─ "effect_preview"        → <EffectPreviewPanel ... />
       ├─ "prompt_package"        → <PromptPackagePanel ... />
       ├─ "runtime_capability"    → <RuntimeCapabilityPanel ... />
       ├─ "engineering_handoff"   → <EngineeringHandoffPanel ... />
       └─ "artifact_memory"       → <ArtifactMemoryPanel ... />
  else:
    → <ActiveNodeContent />（保留为兜底，不再含 timeline-confirm-advance）

StageViewport.cta 唯一 CTA：
  → <StageCTA testId="autopilot-stage-continue-button" />
```

## Components and Interfaces

### 1. `AutopilotRightRail.tsx` — fabric sub-stage 分流

新增一个本地纯函数 `renderFabricSubStageContent`：

```ts
function renderFabricSubStageContent(
  activeSubStage: AutopilotRailSubStage,
  props: AutopilotRightRailProps,
): ReactElement | null {
  switch (activeSubStage) {
    case "agent_crew_fabric":
      return <AgentCrewFabricPanel
        jobId={props.jobId}
        agentCrew={props.agentCrew}
        capabilities={props.capabilities}
        capabilityInvocations={props.capabilityInvocations}
        capabilityEvidence={props.capabilityEvidence}
        locale={props.locale}
        ... // 透传 panel.Pick 的所有字段
      />
    case "effect_preview":
      return <EffectPreviewPanel ... />
    case "prompt_package":
      return <PromptPackagePanel ... />
    case "runtime_capability":
      return <RuntimeCapabilityPanel ... />
    case "engineering_handoff":
      return <EngineeringHandoffPanel ... />
    case "artifact_memory":
      return <ArtifactMemoryPanel ... />
    case "spec_tree":
      return null  // spec_tree 由外层 StreamingDocRenderer 主分支接管
  }
}
```

替换现有 `<ActiveNodeContent>` 调用点（行 ~1437）为：

```tsx
{(activeStageKey === "spec_documents" || activeStageKey === "spec_tree") ? (
  <StreamingDocRenderer ... />
) : currentStage === "fabric" && activeSubStage !== undefined ? (
  <div
    data-sub-stage-placeholder={activeSubStage}
    data-timeline-status="active"
    aria-current="step"
  >
    {renderFabricSubStageContent(activeSubStage, props)}
  </div>
) : (
  // 保留非 fabric 的兜底分支（清理后的 ActiveNodeContent，无 timeline-confirm-advance）
  activeSubStage !== undefined && (
    <div data-sub-stage-placeholder={activeSubStage} ...>
      <ActiveNodeContent ... />
    </div>
  )
)}
```

> 关键约束：`data-sub-stage-placeholder={activeSubStage}` 保留，否则
> `fabric-dispatch.property.test.tsx` 等回归会断。

### 2. `ActiveNodeContent` — 删除内嵌 CTA

删除 `AutopilotRightRail.tsx` 内 `ActiveNodeContent` 函数体里这段（行 ~599–615）：

```tsx
{dataReady && onConfirmAdvance && !isSpecTreeStage && (
  <button data-testid="timeline-confirm-advance"> ... </button>
)}
```

`onConfirmAdvance` prop 仍保留（向后兼容，未来可能被其它兜底分支使用），仅删
按钮渲染。`StageViewport.cta` 保持唯一前进入口。

### 3. `useAutoAdvance` — 关闭 effect_preview 自动推进

`hooks/use-auto-advance.ts` 内：

- **删除** 行 290 附近 effect_preview/preview → prompt_packaging 的 `useEffect`
  分支：

  ```ts
  // BEFORE
  if ((stage === "effect_preview" || stage === "preview") &&
      status === "completed" &&
      !advancedStagesRef.current.has("prompt_packaging")) {
    void advance("prompt_packaging", async () => { ... })
    return
  }
  ```

  替换成 `// 不在此处自动推进；只能由 forceAdvance() 触发`。

- **保留** `forceAdvance()` 内现有 `else if (stage === "effect_preview" || ...)`
  分支：用户手动点击 footer CTA 时仍调用 `generateBlueprintPromptPackages(...)`，
  契约不变。

- **保留** `spec_docs → effect_preview` 与 `prompt_packaging → engineering_landing`
  两条 useEffect 自动推进。本次不变更。

### 4. `EffectPreviewPanel` — Preview_Source_Documents

`panels/EffectPreviewPanel.tsx` 行 1218 起：

```ts
// BEFORE
const acceptedDocuments = useMemo(
  () => documents.filter(
    document => (document.status ?? "draft").toLowerCase() === "accepted"
  ),
  [documents]
)
// AFTER
const previewSourceDocuments = useMemo(
  () => documents.filter(
    document => (document.status ?? "draft").toLowerCase() !== "rejected"
  ),
  [documents]
)
```

下游所有引用 `acceptedDocuments` 的位置（`previewNodeIds` / `previewNodes` 默认
选择 / `canGenerate` / `handleGenerate` / 底部 Badge 计数）改为
`previewSourceDocuments`。`handleGenerate` 的 request options 同步改为
`includeDrafts: true`，避免 UI 因 draft 文档启用生成、请求却排除 draft 的二次错位。
底部 Badge 文案：

```tsx
// BEFORE
{acceptedDocuments.length} 份已接受文档
// AFTER
{previewSourceDocuments.length} 份可用文档
```

英文 fallback 同步：`"N usable documents"`。

## Data Models

不引入新的契约 / store slice / props。

## Test Strategy

### 1. R1：fabric sub-stage 分流（example-based vitest，SSR）

新增 `client/src/pages/autopilot/right-rail/__tests__/fabric-sub-stage-content-dispatch.test.tsx`，
最小子树渲染 `<AutopilotRightRail>`，每个 fabric sub-stage 一例：

```ts
const cases: Array<[AutopilotRailSubStage, string]> = [
  ["agent_crew_fabric",     "data-testid='agent-crew-fabric-panel'"],     // 或既有断点
  ["effect_preview",        "data-testid='effect-preview-generate-button'"],
  ["prompt_package",        "data-testid='prompt-package-...'"],          // 选 PromptPackagePanel 已有 testId
  ["runtime_capability",    "..."],
  ["engineering_handoff",   "..."],
  ["artifact_memory",       "..."],
]
```

每例断言：
- 包含对应 panel 的稳定 marker；
- 不含 `data-testid="timeline-confirm-advance"`；
- 仍含 `data-sub-stage-placeholder="<sub>"`（保留对既有
  `fabric-dispatch.property.test.tsx` 的兼容形状）。

### 2. R2：CTA 单一性

新增一例：在任意 fabric sub-stage 下断言整段 markup 含 **0** 个
`data-testid="timeline-confirm-advance"` 与 **1** 个
`data-testid="autopilot-stage-continue-button"`（仅当 `manualAdvanceAction.type !==
"none"`）。

### 3. R3：useAutoAdvance 不再自动推进 effect_preview

新增 `client/src/pages/autopilot/right-rail/hooks/__tests__/use-auto-advance.effect-preview.test.ts`：

- 采用仓库既有 hook 测试风格：source-level contract test，不引入 Testing Library /
  jsdom / happy-dom。
- 断言 useEffect 自动推进区域不再包含
  `(stage === "effect_preview" || stage === "preview")` → `advance("prompt_packaging")`
  分支。
- 断言 `forceAdvance` 中仍保留
  `(stage === "effect_preview" || stage === "preview")` → `advance("prompt_packaging")`
  分支，且参数包含 `includeDrafts: true, includePreviewDrafts: true`。
- 断言 `spec_docs` → `effect_preview` 与 `prompt_packaging` →
  `engineering_landing` 两条 useEffect 自动推进分支仍存在。

### 4. R4：Preview_Source_Documents

扩展 `panels/__tests__/EffectPreviewPanel.production-snapshot.test.tsx` 或新增
sibling 测试：

- Fixture: documents 全部为 `draft`。
- 断言：markup 含 `disabled` 属性的生成按钮**不**存在（即按钮 enabled）；
  markup 含 `份可用文档` 字样而非"份已接受文档"。

### 5. 现有测试保护

- `client/src/pages/autopilot/right-rail/__tests__/autopilot-right-rail-cards.test.tsx`：
  对 `data-testid="timeline-confirm-advance"` 的断言迁移到
  `data-testid="autopilot-stage-continue-button"`，"用户能看到一个继续按钮"
  的覆盖力度不下降。
- `panels/__tests__/EffectPreviewPanel.image-integration.test.tsx` /
  `.settings-integration.test.tsx` / `.production-snapshot.test.tsx`：fixture
  原本就有 accepted 文档，这些用例继续通过；`previewSourceDocuments` 包含
  accepted 是 `!== "rejected"` 的真子集，断言不需要改。
- `use-auto-advance.test.ts` / `use-auto-advance.spec-tree.test.ts`：spec_tree
  契约保持，spec_docs→effect_preview 与 prompt_packaging→engineering_landing
  契约保持；effect_preview→prompt_packaging 用例如果存在，需要相应**翻转**
  断言（"自动调用 1 次"→"自动调用 0 次 + forceAdvance 1 次"）。

### 6. 验证命令

```text
node --run check                                            # 类型检查 0
npx vitest run --config vitest.config.server.ts ...         # 不涉及 server 改动，但跑一遍守住
npx vitest run client/src/pages/autopilot/right-rail        # 主验证
```

## Error Handling

- **fabric sub-stage 兜底**：`renderFabricSubStageContent` 的 switch 是穷尽的；
  TypeScript `never` 检查保护新增 sub-stage 时编译不过。
- **panel 自身错误**：每个 fabric panel 已经有自己的 loading / empty / error 状态，
  本次不增加任何错误边界。
- **forceAdvance 在 effect_preview 阶段**：与既有 `forceAdvance` 逻辑共用，5 分钟
  超时保护沿用。

## 关键决策与取舍

| 决策 | 选择 | 理由 |
| ---- | ---- | ---- |
| 视觉折叠 STEP 06 是否拆开 | 保留折叠 | 拆开会影响 `mapSubStageToStageIndex` / STAGE_ORDER / 7 个回归测试，本次只想消除"标题与内容错位"，不想重做视觉 step。 |
| 自动推进停几条 | 只停 effect_preview→prompt_packaging | 截图反映的核心痛点就是这一条；其它两条不在用户当前抱怨范围内，停了会扩大 5 个 use-auto-advance 测试基线变更。 |
| `ActiveNodeContent` 是否整体删除 | 保留为非 fabric 兜底 | 部分 dev / fallback 路径（如 `currentStage !== "fabric"` 的异常子阶段）仍可能落到这里，整体删除会引入未知回归。本次只删内嵌 CTA。 |
| `EffectPreviewPanel` 过滤口径 | `!== "rejected"` 而非"全部" | 与 server-side `includeDrafts: true` 已对齐；保留对 rejected 文档的排除，保持"用户主动拒绝过的不要重新参与"语义。 |

## 不做的事

- 不重做 fabric 阶段的视觉 step 划分（仍是 5-in-1 折叠）。
- 不改 `resolveRailSubStage` / `mapSubStageToStageIndex`。
- 不改任何后端 emitter / 路由 / 契约。
- 不在 panel 内部新增 `useBlueprintRealtimeStore` 订阅。
- 不为 prompt_package 等子阶段新建独立视觉 step（如果未来产品要拆，是另外的 spec）。
