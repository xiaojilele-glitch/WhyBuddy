# Implementation Plan: autopilot-image-rendering-and-visual-system

## Overview

本 spec 是一个跨三阶段的 mega-spec，按 Phase 1（effect preview 真实图像渲染 Stage C 流水线）→ Phase 2（视觉令牌系统）→ Phase 3（项目主链时间线）顺序组织任务。三个 Phase 在 DAG 中存在并行机会：Phase 2 的 `visual-tokens-placeholder` 是 Phase 1 与 Phase 3 客户端组件取色的单一替换点，必须先于这两类组件落地。

实现语言为 TypeScript（设计文档已显式使用 TS interface 与现有仓库约定一致）。所有服务端代码位于 `server/routes/blueprint/effect-preview/`，所有客户端组件使用 PascalCase 文件名，所有 lib 模块使用 kebab-case。

按以下原则组织 prompts：每个任务自描述、列出文件路径与 requirement 引用、PBT sub-task 标注 Property number 与 Validates 关系，可被 code-generation LLM 独立执行。

## Tasks

## Phase 1: Effect Preview Real Image Rendering

- [x] 1. Backend types extension — `BlueprintEffectPreview` 新增字段
  - [x] 1.1 扩展 `shared/blueprint/contracts.ts` 的 `BlueprintEffectPreview` 类型
    - 新增 `architectureSvgDraft?: string`、`imageBase64ByNodeId?: Record<string, NodeImageRecord>`、`textOnlyEffectPreview?: { active: boolean; reason: FallbackTier | "empty-spec"; errorSummary?: string }`
    - 新增 `NodeImageRecord` 接口（`b64`、`mimeType`、`promptUsed`、`generatedAt`）
    - 在 `progressPlan[]` 元素类型上新增可选字段 `fallbackTier?: FallbackTier`、`startedAt?: string`、`endedAt?: string`、`errorSummary?: string`
    - 导出 `FallbackTier` 联合类型 `"env-disabled" | "key-missing" | "timeout" | "quota" | "moderation" | "upstream-failure"`
    - 文件路径：`shared/blueprint/contracts.ts`
    - _Requirements: 1.3, 3.3, 4.3, 6.4, 8.1, 18.1_

- [x] 2. Backend image API client — `image-api-client.ts`
  - [x] 2.1 创建 `ImageApiClient` 模块与 env 配置解析
    - 实现模块级 `getResolvedConfig()`：一次性读取 `IMAGE_GEN_API_KEY`、`IMAGE_GEN_BASE_URL`、`IMAGE_GEN_MODEL`、`IMAGE_GEN_PATH`、`IMAGE_GEN_DEFAULT_SIZE`、`IMAGE_GEN_DEFAULT_ASPECT`、`IMAGE_GEN_TIMEOUT_MS` 七个环境变量并验证 enum / 整数边界
    - 提供默认值：`model="gpt-image-2"`、`path="/v1/images/generations"`、`defaultSize="1K"`、`defaultAspect="1:1"`、`timeoutMs=60000`
    - 文件路径：`server/routes/blueprint/effect-preview/image-api-client.ts`
    - _Requirements: 5.1, 5.2, 5.3, 5.5, 7.1, 7.2, 18.1_

  - [x] 2.2 实现 `ImageApiClient.generate()` HTTP 调用与响应解码
    - 使用 `fetch` 发起 POST 请求，URL 由 `baseUrl + path` 拼接
    - 请求体严格包含 6 字段：`model`、`prompt`、`response_format: "b64_json"`、`image_size`、`aspect_ratio`、`n: 1`
    - 请求头包含 `Authorization: Bearer ${apiKey}` 与 `Content-Type: application/json`
    - 成功路径：从 `json.data[0].b64_json` 与 `json.data[0].mime_type` 解码并返回 `ImageApiSuccess`
    - 实现 `AbortController` + `setTimeout(timeoutMs)` 处理超时
    - 永不抛错：所有异常翻译为 `ImageApiFailure`
    - 文件路径：`server/routes/blueprint/effect-preview/image-api-client.ts`
    - _Requirements: 5.1, 5.4, 5.6, 6.3, 7.4_

  - [x] 2.3 实现 6 级 fallback 检测与错误码映射
    - 按 `["env-disabled", "key-missing", "timeout", "quota", "moderation", "upstream-failure"]` 顺序判定 tier
    - `IMAGE_GEN_DISABLED=true` 或 `AUTOPILOT_REAL_RUNTIME=false` → `env-disabled`，0 outgoing 请求
    - `apiKey` 缺失 → `key-missing`，0 outgoing 请求
    - HTTP 状态 429 / 响应 code 包含 `quota_exceeded` → `quota`
    - 响应 code 包含 `moderation` / `content_filter` → `moderation`
    - 响应 code === `AGENT_DOMAIN_MISMATCH` 或 `OPENAI_IMAGE_EDIT_FAILED` → `upstream-failure`，`errorSummary` 字面量保留 upstream code
    - 文件路径：`server/routes/blueprint/effect-preview/image-api-client.ts`
    - _Requirements: 5.7, 6.1, 6.2, 6.5, 7.3_

- [x] 3. Backend prompt template library — `prompt-template-library.ts`
  - [x] 3.1 实现 `PromptTemplateLibrary` 4 风格模板与 metaPrefix
    - 提供风格枚举 `PromptStyleKey = "system_architecture_diagram" | "ui_mockup" | "concept_sketch" | "product_hero"`
    - 实现 `render(input: PromptTemplateInput): string`：style 缺失时回退到 `system_architecture_diagram`
    - 所有产出 prompt 以同一 `metaPrefix` 常量字符串开头（包含 mission 上下文与风格标识）
    - 实现 `styles(): ReadonlyArray<PromptStyleKey>` 暴露所有可用 key
    - 确定性：同输入必同输出（不使用 `Date.now()` / 随机数）
    - 文件路径：`server/routes/blueprint/effect-preview/prompt-template-library.ts`
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 4. Backend SVG architecture drafter — `svg-architecture-drafter.ts`
  - [x] 4.1 实现 `SvgArchitectureDrafter.draft()`
    - 接收 `architectureNotes: ReadonlyArray<string>` 与 `missionId: string`
    - 成功输出包含 `<svg ...>...</svg>` 完整字符串的 `{ kind: "ok", svg }`
    - 失败时返回 `{ kind: "skipped", reason: string }`，永不抛错
    - 文件路径：`server/routes/blueprint/effect-preview/svg-architecture-drafter.ts`
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 5. Backend scheduler — `scheduler.ts`
  - [x] 5.1 实现 `EffectPreviewScheduler.plan()`
    - 接收 `dependencyOrder: ReadonlyArray<string>`，按相同顺序产出 `progressPlan[]`，所有 entry 初始 state="pending"
    - 文件路径：`server/routes/blueprint/effect-preview/scheduler.ts`
    - _Requirements: 4.1_

  - [x] 5.2 实现 `markFailed` 与 `markCompleted` 不可变更新
    - `markFailed(plan, nodeId, tier, summary)`：返回新数组，目标节点 state="failed"、`fallbackTier=tier`、`errorSummary=summary`、`endedAt=ISO8601 now`，其他节点不变
    - `markCompleted(plan, nodeId)`：返回新数组，目标节点 state="completed"、`endedAt=ISO8601 now`
    - 单点失败不影响其它节点的 state
    - 文件路径：`server/routes/blueprint/effect-preview/scheduler.ts`
    - _Requirements: 4.2, 4.3_


- [x] 6. Backend ImageService orchestrator — `image-service.ts`
  - [x] 6.1 实现 `ImageService.runStageC()` 4 步串行流水线骨架
    - gate 校验：`specDocuments` 缺失或为空 → 直接写 `textOnlyEffectPreview = { active: true, reason: "empty-spec" }` 并返回，零 outgoing 请求
    - 顺序执行：步骤 1 prompt template 渲染、步骤 2 SVG draft 生成（失败则跳过但继续）、步骤 3 scheduler.plan、步骤 4 串行 raster 调用
    - SVG 成功时写入 `architectureSvgDraft` 字段；失败时不污染该字段，仅在 progressPlan 上记录降级原因
    - 文件路径：`server/routes/blueprint/effect-preview/image-service.ts`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 3.2, 3.3_

  - [x] 6.2 实现节点串行 raster 调用与 fallback 写回
    - 按 `progressPlan` 顺序对每个节点调用 `imageApiClient.generate(...)`
    - 成功：写入 `imageBase64ByNodeId[nodeId] = { b64, mimeType, promptUsed, generatedAt }`，调用 `scheduler.markCompleted`
    - 失败：调用 `scheduler.markFailed(plan, nodeId, tier, errorSummary)` 并写入 `textOnlyEffectPreview`
    - 单点失败不阻断后续节点
    - 调用 `BlueprintCostTracker.record({ tier, durationMs, model, estimatedCost })` 一次每节点
    - 文件路径：`server/routes/blueprint/effect-preview/image-service.ts`
    - _Requirements: 4.2, 6.4, 6.5, 7.3, 8.1_

- [x] 7. Backend wiring — extend `ctx.effectPreviewLlmService` 与路由集成
  - [x] 7.1 在 `server/routes/blueprint.ts` 中扩展 `ctx.effectPreviewLlmService` 装配 `ImageService`
    - 在 ~L13442 附近的 ctx 初始化逻辑中实例化 `ImageApiClient`、`PromptTemplateLibrary`、`SvgArchitectureDrafter`、`EffectPreviewScheduler`、`ImageService`
    - 把 `runStageC` 方法挂到 `ctx.effectPreviewLlmService` 上对外暴露
    - 在 spec_documents 写入完成事件 handler 中调用 `runStageC` 并把返回的 `BlueprintEffectPreview` 写回 mission artifact
    - 文件路径：`server/routes/blueprint.ts`
    - _Requirements: 1.1, 7.4_

- [x] 8. Backend env vars — extend `.env.example`
  - [x] 8.1 在 `.env.example` 追加 7 个 `IMAGE_GEN_*` 变量与中文注释
    - `IMAGE_GEN_API_KEY=`（注释：仅服务端读取，绝不返回到客户端响应；缺失触发 key-missing 降级）
    - `IMAGE_GEN_BASE_URL=`（注释：image proxy 域名，例如 https://image-proxy.example.com）
    - `IMAGE_GEN_MODEL=gpt-image-2`（注释：枚举内 gpt-image-2 / gemini-2.5-flash-image / gemini-3.1-flash-image-preview / gemini-3-pro-image-preview）
    - `IMAGE_GEN_PATH=/v1/images/generations`（注释：与 /v1/image/created 二选一）
    - `IMAGE_GEN_DEFAULT_SIZE=1K`（注释：枚举 1K / 2K / 4K / 512）
    - `IMAGE_GEN_DEFAULT_ASPECT=1:1`（注释：枚举 1:1 / 2:3 / 3:2 / auto）
    - `IMAGE_GEN_TIMEOUT_MS=60000`（注释：整数毫秒，必须 > 0）
    - 文件路径：`.env.example`
    - _Requirements: 5.1, 5.2, 5.3, 5.5, 6.3, 10.1_

- [x] 9. Frontend EffectPreviewImagePanel
  - [x] 9.1 实现 `EffectPreviewImagePanel` 组件
    - 接收 props：`missionId`、`activeStageKey`、`progressPlan`、`imageBase64ByNodeId`、`architectureSvgDraft`、`visualTokens`、`cache`、`onDownload`
    - `activeStageKey === "effect_preview"` 时挂在 autopilot 右侧 rail 渲染
    - 节点 running 时渲染 conic-gradient loading orb 并标注当前节点名称
    - gallery 按 `nodeId` 分组展示图像，每组带 `data-node-id={nodeId}` 属性
    - download 按钮点击时使用 `effect-preview-${nodeId}-v${version}-${timestamp}.png` 文件名调用 `onDownload`
    - 所有颜色值通过 `visualTokens` 取色，禁止硬编码 `#`、`rgb(`、`hsl(`、`oklch(` 字面量
    - 文件路径：`client/src/components/autopilot/EffectPreviewImagePanel.tsx`
    - _Requirements: 8.2, 8.3, 9.1, 9.2, 17.1, 18.3_

- [x] 10. Frontend AutopilotImageSettingsPanel
  - [x] 10.1 实现 `AutopilotImageSettingsPanel` 组件与脱敏逻辑
    - 接收 `settings: ImageSettingsViewModel`（`baseUrl`、`model`、`path`、`defaultSize`、`defaultAspect`、`timeoutMs`、`maskedApiKey`）
    - `apiKey.length >= 14` 时显示 `apiKey.slice(0,8) + "•".repeat(apiKey.length - 14) + apiKey.slice(-6)`
    - `apiKey.length < 14` 或 `null` 时显示「未配置」并禁用手动重试按钮
    - 检测到 upstream code === `AGENT_DOMAIN_MISMATCH` 时额外提示「请确认 IMAGE_GEN_BASE_URL 与当前 key 绑定的代理域一致」
    - 颜色取自 `visualTokens`，禁止硬编码颜色字面量
    - 文件路径：`client/src/components/autopilot/AutopilotImageSettingsPanel.tsx`
    - _Requirements: 10.1, 10.2, 10.3, 17.1_

- [x] 11. Frontend ImageGalleryCache (IndexedDB LRU 24)
  - [x] 11.1 实现 `ImageGalleryCache` IndexedDB 24-LRU 缓存
    - 导出常量 `IMAGE_GALLERY_CACHE_CAP = 24`
    - 实现 `get(key)`：命中则刷新 `storedAt = Date.now()`（LRU touch）并返回 entry；未命中返回 `null`
    - 实现 `put(entry)`：写入后若容量 > 24，按 `storedAt` 升序淘汰最早一条
    - 实现 `size()` 用于测试与诊断
    - 使用项目现有 IndexedDB 工具（参考 `client/src/lib/browser-runtime-storage.ts` 模式）
    - 文件路径：`client/src/lib/autopilot/image-gallery-cache.ts`
    - _Requirements: 9.3, 9.4_


- [x] 12. Phase 1 property-based tests
  - [x]* 12.1 PromptTemplateLibrary determinism property test
    - **Property 1: PromptTemplateLibrary determinism**
    - **Validates: Requirements 2.2, 2.3, 2.4**
    - 使用 fast-check 任意 `PromptTemplateInput`：断言 `render(input)` 调用两次返回严格相等字符串；style 缺省与 `style="system_architecture_diagram"` 等价；所有产出以同一 `metaPrefix` 前缀开头
    - `fc.assert(prop, { numRuns: 100 })`
    - tag：`Feature: autopilot-image-rendering-and-visual-system, Property 1: PromptTemplateLibrary determinism`
    - 文件路径：`server/routes/blueprint/effect-preview/__tests__/prompt-template-library.property.test.ts`
    - _Requirements: 2.2, 2.3, 2.4_

  - [x]* 12.2 ImageApiClient request body schema property test
    - **Property 2: ImageApiClient request body schema validity**
    - **Validates: Requirements 1.4, 5.1, 5.2, 5.3, 5.4, 5.5**
    - mock `fetch` 拦截请求；fast-check 任意合法 `ImageApiRequest`
    - 断言 body 恰好 6 字段；`model` ∈ 4 模型枚举；`image_size` ∈ {"1K","2K","4K","512"}；`aspect_ratio` ∈ {"1:1","2:3","3:2","auto"}；`response_format === "b64_json"`；`n === 1`
    - 断言 `Authorization` 头匹配 `^Bearer .+$`；URL 后缀根据 `IMAGE_GEN_PATH` 切换
    - 文件路径：`server/routes/blueprint/effect-preview/__tests__/image-api-client.property.test.ts`
    - _Requirements: 1.4, 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x]* 12.3 ImageApiClient response round-trip property test
    - **Property 3: ImageApiClient response round-trip**
    - **Validates: Requirements 5.6, 8.1**
    - fast-check 合成 `{ data: [{ b64_json, mime_type }] }`；断言 `ImageApiSuccess.b64Json` 与 `mimeType` 与输入字段相等
    - 集成断言：在 `image-service.test.ts` 中验证 `imageBase64ByNodeId[nodeId].b64` / `mimeType` 与上游字段一致
    - 文件路径：`server/routes/blueprint/effect-preview/__tests__/image-api-client.property.test.ts`
    - _Requirements: 5.6, 8.1_

  - [x]* 12.4 6-tier fallback ordering property test
    - **Property 4: 6-tier fallback ordering — no tier skipped, highest-priority match wins**
    - **Validates: Requirements 5.7, 6.1, 6.2, 6.3, 6.4, 6.5**
    - fast-check 失败子集 `S ⊆ {env-disabled, key-missing, timeout, quota, moderation, upstream-failure}`：断言写入的 `fallbackTier` 等于规范序列首个匹配
    - 断言 `key-missing` 时 outgoing 请求计数 === 0
    - 断言 `moderation` 命中时 outgoing 请求计数 ≤ 1（不重试）
    - 断言上游 `AGENT_DOMAIN_MISMATCH` / `OPENAI_IMAGE_EDIT_FAILED` → tier === `upstream-failure` 且原码字面量出现在 `errorSummary`
    - 文件路径：`server/routes/blueprint/effect-preview/__tests__/image-api-client.property.test.ts`
    - _Requirements: 5.7, 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x]* 12.5 Scheduler topological ordering property test
    - **Property 5: Scheduler topological ordering and per-node fault isolation**
    - **Validates: Requirements 1.1, 1.2, 1.3, 3.3, 4.1, 4.2, 4.3**
    - fast-check 任意 `dependencyOrder: string[]`：断言 `plan(...)` 输出 `nodeId` 顺序等于输入
    - 任意失败子集 `F` 下：`dependencyOrder \ F` 节点状态 ∈ {completed, text-only}；`F` 节点 `state === "failed"` 且 `fallbackTier` 非空
    - empty `specDocuments` 输入 → `textOnlyEffectPreview.active === true`、`reason === "empty-spec"`、outgoing 请求计数 === 0
    - 成功运行下断言 `architectureSvgDraft` 字符串值不出现在 `imageBase64ByNodeId` 任何 `b64` 中（字段隔离）
    - 文件路径：`server/routes/blueprint/effect-preview/__tests__/scheduler.property.test.ts`
    - _Requirements: 1.1, 1.2, 1.3, 3.3, 4.1, 4.2, 4.3_

  - [x]* 12.6 ImageGalleryCache LRU 24-cap property test
    - **Property 6: ImageGalleryCache LRU 24-cap**
    - **Validates: Requirements 9.3, 9.4**
    - fast-check 任意 `put` 操作序列：断言 `size()` ≤ 24；溢出时被淘汰的 entry 是 `storedAt` 最小者
    - 断言 `put` 后 `get` 同 key 返回字段相等的非空 entry
    - 断言从未 put 或已被淘汰的 key `get` 返回 `null`
    - 文件路径：`client/src/components/autopilot/__tests__/image-gallery-cache.property.test.ts`
    - _Requirements: 9.3, 9.4_

  - [x]* 12.7 Filename generation determinism property test
    - **Property 7: Filename generation determinism**
    - **Validates: Requirements 8.2, 8.3**
    - fast-check 任意 `nodeId`、`version`、`timestamp`：断言生成文件名严格等于 `effect-preview-${nodeId}-v${version}-${timestamp}.png`
    - 任意 `imageBase64ByNodeId` 含 N 个不同 `nodeId`：断言 panel 渲染 N 个 `data-node-id` group 元素，无两个不同 `nodeId` 共享一个 group
    - 文件路径：`client/src/components/autopilot/__tests__/EffectPreviewImagePanel.test.tsx`
    - _Requirements: 8.2, 8.3_

  - [x]* 12.8 Masked API key display property test
    - **Property 9: Masked API key display correctness**
    - **Validates: Requirements 10.2, 10.3**
    - fast-check `apiKey.length >= 14`：断言渲染文本前 8 字符 === `apiKey.slice(0,8)`、后 6 字符 === `apiKey.slice(-6)`、中间字符全为单一 mask 字符且数量 === `length - 14`
    - `apiKey.length < 14` 或 `null` 时断言渲染「未配置」且重试按钮 `disabled`
    - 文件路径：`client/src/components/autopilot/__tests__/AutopilotImageSettingsPanel.test.tsx`
    - _Requirements: 10.2, 10.3_

- [x] 13. Phase 1 example / integration tests
  - [x]* 13.1 ImageService 集成测试
    - 例子级测试：empty `specDocuments` 跳过 Stage C 的零网络调用断言
    - 4 步顺序固定（mock 每步 spy 调用顺序）
    - `architectureSvgDraft` 与 `imageBase64ByNodeId` 字段不互相污染
    - `BlueprintCostTracker.record` 调用次数 === outgoing 请求次数
    - 文件路径：`server/routes/blueprint/effect-preview/__tests__/image-service.test.ts`
    - _Requirements: 1.1, 1.2, 6.4, 7.3, 8.1_

  - [x]* 13.2 EffectPreviewImagePanel 例子测试
    - 渲染条件：`activeStageKey === "effect_preview"` 时挂载，其它 stage 时不渲染
    - loading orb 存在性：`progressPlan` 中存在 running 节点时 conic-gradient orb DOM 出现
    - download 文件名：模拟点击 download 后 `onDownload` 收到的文件名匹配 Property 7 模板
    - 文件路径：`client/src/components/autopilot/__tests__/EffectPreviewImagePanel.test.tsx`
    - _Requirements: 8.2, 9.1, 9.2_

- [x] 14. Phase 1 checkpoint
  - Ensure all Phase 1 tests pass, ask the user if questions arise.


## Phase 2: Visual Tokens System

- [x] 15. Visual tokens module
  - [x] 15.1 实现 `visual-tokens.ts` — 8-key OKLCH 调色板
    - 导出 `VisualTokenKey` 联合类型：`"entry" | "frontend" | "backend-core" | "ai-capability" | "governance" | "business-loop" | "data-state" | "external-integration"`
    - 导出 `OklchPair` 接口（`light: string`、`dark: string`，均以 `"oklch("` 起始、`")"` 结束）
    - 导出 `visualTokens: VisualTokenSet`（8 个 key 完整覆盖）
    - 导出 `VISUAL_TOKEN_KEYS: ReadonlyArray<VisualTokenKey>`（length === 8）
    - 实现 `resolveToken(key: VisualTokenKey, theme: "light" | "dark"): string`
    - light / dark 取值与项目现有主题系统的 OKLCH 色彩空间保持一致（参考 `client/src/index.css` 既有 OKLCH 变量）
    - 文件路径：`client/src/lib/autopilot/visual-tokens.ts`
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 18.2_

- [x] 16. Visual tokens placeholder — 单一替换点
  - [x] 16.1 创建 `visual-tokens-placeholder.ts` 软耦合接口
    - 在 Phase 2 上线前，导出与 `visual-tokens.ts` 相同的 `VisualTokenSet` 形状作为占位常量
    - 占位实现可直接 `re-export from "./visual-tokens"`，但保持模块独立以便 Phase 1+3 组件 import 此文件而非直接 import `visual-tokens`
    - 注释明确：「此模块是 Phase 1+3 组件的单一替换点，禁止在 component 内部 import `visual-tokens.ts`」
    - 文件路径：`client/src/lib/autopilot/visual-tokens-placeholder.ts`
    - _Requirements: 17.2, 17.3_

- [x] 17. HorizontalCrossCutBar 组件
  - [x] 17.1 实现 `HorizontalCrossCutBar` 跨切链路条
    - 接收 props：`nodes: ReadonlyArray<CrossCutNode>` 与 `visualTokens: VisualTokenSet`
    - 按数组顺序水平展示链路（节点 + 连接线）
    - 文本与连接线颜色取自 `visualTokens["business-loop"]` 与 `visualTokens["data-state"]`，禁止硬编码
    - 主题切换时通过 React 重渲染同步刷新颜色
    - 文件路径：`client/src/components/autopilot/HorizontalCrossCutBar.tsx`
    - _Requirements: 12.1, 12.2, 12.3, 17.1, 18.3_

- [x] 18. CodeBoundarySidebar 组件
  - [x] 18.1 实现 `CodeBoundarySidebar` 代码边界侧栏
    - 接收 props：`nodes: ReadonlyArray<CodeBoundaryNode>` 与 `visualTokens: VisualTokenSet`
    - 节点 `codePaths` 存在时按目录树展示
    - 节点 `codePaths` 缺失时渲染「未声明代码边界」占位提示
    - 文字色取自 `visualTokens["frontend"]` 与 `visualTokens["backend-core"]`
    - 与 `design.md` 视图保持并排布局（容器使用 flex 或 grid 双栏）
    - 文件路径：`client/src/components/autopilot/CodeBoundarySidebar.tsx`
    - _Requirements: 13.1, 13.2, 13.3, 17.1, 18.3_

- [x] 19. Phase 2 property-based tests
  - [x]* 19.1 VisualTokens 完整性与 OKLCH 格式 property test
    - **Property 8: VisualTokens light/dark variant completeness and OKLCH format**
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.4, 12.2, 13.3, 15.4, 16.3, 17.1**
    - fast-check 遍历 `VISUAL_TOKEN_KEYS`：断言 length === 8；每个 key 的 `light` 与 `dark` 均为非空字符串以 `"oklch("` 起始、`")"` 结束
    - 任意 `theme ∈ {"light","dark"}`：断言 `resolveToken(key, theme) === visualTokens[key][theme]`
    - 文件路径：`client/src/lib/autopilot/__tests__/visual-tokens.test.ts`
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 12.2, 13.3, 15.4, 16.3, 17.1_

- [x] 20. Phase 2 example tests
  - [x]* 20.1 HorizontalCrossCutBar 渲染与主题切换测试
    - 例子测试：传入 3 节点数组，断言 DOM 包含 3 个节点 + 2 个连接线
    - 切换 theme prop 后断言 inline style color 与 `resolveToken("business-loop", newTheme)` 一致
    - 文件路径：`client/src/components/autopilot/__tests__/HorizontalCrossCutBar.test.tsx`
    - _Requirements: 12.1, 12.3, 17.1_

  - [x]* 20.2 CodeBoundarySidebar 渲染测试
    - 节点带 `codePaths` 时按路径渲染
    - 节点不带 `codePaths` 时渲染「未声明代码边界」字面量
    - 文件路径：`client/src/components/autopilot/__tests__/CodeBoundarySidebar.test.tsx`
    - _Requirements: 13.1, 13.2_

- [x] 21. Phase 2 checkpoint
  - Ensure all Phase 2 tests pass, ask the user if questions arise.


## Phase 3: Project Main Chain Timeline

- [x] 22. ProjectMainChainTimeline 组件
  - [x] 22.1 实现 `ProjectMainChainTimeline` 6 步主链时间线
    - 接收 props：`steps: ReadonlyArray<MainChainStep>`（length 恒为 6）、`activeKey?`、`visualTokens`
    - 严格按 `["Project", "Clarification", "Spec", "Route", "Execution", "Evidence"]` 顺序渲染
    - 状态映射 `statusClass[s]`：`pending → "is-pending"`（灰）、`running → "is-running"`（蓝色脉冲）、`completed → "is-completed"`（绿色对勾）、`blocked → "is-blocked"`（黄色 ⚠）、`failed → "is-failed"`（红色 ✗）
    - 任意时刻最多一个步骤带 `is-active` class
    - 颜色取自 `visualTokens`，禁止硬编码颜色字面量；从 `client/src/lib/autopilot/visual-tokens-placeholder` 导入
    - 挂载点：`client/src/pages/ProjectCockpitHome.tsx`（不挂在 `AutopilotRoutePage`）
    - 文件路径：`client/src/components/autopilot/ProjectMainChainTimeline.tsx`
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 17.1, 18.3_

  - [x] 22.2 在 `ProjectCockpitHome` 挂载 `ProjectMainChainTimeline`
    - 在 `client/src/pages/ProjectCockpitHome.tsx` 顶部添加渲染入口
    - 数据来源：从现有 project-first store / mission projection 派生 6 步状态
    - 文件路径：`client/src/pages/ProjectCockpitHome.tsx`
    - _Requirements: 14.4_

- [x] 23. EffectPreviewScheduleTimeline 组件
  - [x] 23.1 实现 `EffectPreviewScheduleTimeline` 调度时间线 + Framer Motion FLIP
    - 接收 props：`progressPlan: ReadonlyArray<ProgressPlanEntry>`、`dependencyOrder: ReadonlyArray<string>`、`visualTokens`
    - `activeStageKey === "effect_preview"` 时渲染在 Phase 1 右侧 rail 槽位
    - `dependencyOrder` 变化时使用 Framer Motion `AnimatePresence` + `layoutId={nodeId}` 实现 FLIP 位移过渡
    - 颜色取自 `visualTokens` 占位模块，禁止硬编码状态色
    - 文件路径：`client/src/components/autopilot/EffectPreviewScheduleTimeline.tsx`
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 17.1, 18.3_

- [x] 24. CapabilitySnapshotBadges 组件
  - [x] 24.1 实现 `CapabilitySnapshotBadges` 4 静态角标
    - 接收 props：`badges: ReadonlyArray<CapabilitySnapshotBadge>`（length 恒为 4）、`visualTokens`
    - 静态角标：`{ id: "shared-contracts", text: "14 shared contracts" }`、`{ id: "specs", text: "77 specs" }`、`{ id: "capability-bridges", text: "5 capability bridges" }`、`{ id: "runtimes", text: "Mission/Browser/Docker runtimes" }`
    - 文本来自静态配置，不依赖运行时计算
    - 背景与文字色取自 `visualTokens` 占位模块
    - 挂载点：`ProjectCockpitHome` 顶栏
    - 文件路径：`client/src/components/autopilot/CapabilitySnapshotBadges.tsx`
    - _Requirements: 16.1, 16.2, 16.3, 17.1, 18.3_

- [x] 25. Phase 3 property-based tests
  - [x]* 25.1 ProjectMainChainTimeline 状态映射 property test
    - **Property 10: ProjectMainChainTimeline state-to-class mapping & step ordering**
    - **Validates: Requirements 14.1, 14.2, 14.3**
    - fast-check 任意 `steps: MainChainStep[]`（length 6）：断言 DOM label 序列严格等于 `["Project","Clarification","Spec","Route","Execution","Evidence"]`
    - 断言 `statusClass[s]` 映射唯一（无两 status 共享 class）
    - 断言至多一个步骤带 `is-active` class
    - 文件路径：`client/src/components/autopilot/__tests__/ProjectMainChainTimeline.test.tsx`
    - _Requirements: 14.1, 14.2, 14.3_

- [x] 26. Phase 3 example tests
  - [x]* 26.1 EffectPreviewScheduleTimeline FLIP 渲染测试
    - 例子测试：初始 `dependencyOrder=["a","b","c"]` 渲染后变更为 `["c","a","b"]`，断言每个 nodeId 的 `layoutId` 保持稳定
    - mock Framer Motion 验证 `layoutId={nodeId}` props 传递正确
    - 文件路径：`client/src/components/autopilot/__tests__/EffectPreviewScheduleTimeline.test.tsx`
    - _Requirements: 15.2, 15.3_

  - [x]* 26.2 CapabilitySnapshotBadges 静态渲染测试
    - 断言渲染恰好 4 个角标且文本与静态配置严格一致
    - 文件路径：`client/src/components/autopilot/__tests__/CapabilitySnapshotBadges.test.tsx`
    - _Requirements: 16.1, 16.2_

- [x] 27. Phase 3 checkpoint
  - Ensure all Phase 3 tests pass, ask the user if questions arise.


## Cross-Phase Finalization

- [x] 28. 跨阶段集成校验
  - [x] 28.1 校验 Phase 1 + Phase 3 组件统一 import `visual-tokens-placeholder`
    - grep 确认 `EffectPreviewImagePanel.tsx`、`AutopilotImageSettingsPanel.tsx`、`EffectPreviewScheduleTimeline.tsx`、`ProjectMainChainTimeline.tsx`、`CapabilitySnapshotBadges.tsx`、`HorizontalCrossCutBar.tsx`、`CodeBoundarySidebar.tsx` 均从 `client/src/lib/autopilot/visual-tokens-placeholder` 导入颜色，未直接 import `visual-tokens.ts`
    - 文件路径：上述 7 个组件文件
    - _Requirements: 17.2, 17.3_

- [x] 29. CI / lint 静态校验
  - [x] 29.1 添加颜色字面量静态检查
    - 在 `package.json` `scripts` 或独立 lint 脚本中新增 `lint:autopilot-colors`：使用 ripgrep / eslint custom rule 在 Phase 1+3 组件文件范围内搜索 `#[0-9a-fA-F]{3,8}`、`rgb\(`、`hsl\(`、`oklch\(` 字面量
    - 命中即失败；允许的来源仅为通过 `resolveToken` / `visualTokens` 间接出现
    - 文件路径：`scripts/lint-autopilot-colors.mjs`、`package.json`
    - _Requirements: 17.1, 17.3_

- [x] 30. Final checkpoint
  - Ensure all tests across Phase 1 + Phase 2 + Phase 3 pass, run `node --run check` 确认未引入新的 TypeScript 错误，ask the user if questions arise.


## Phase 4: Production Integration & Runtime Closure

> Phase 1-3 的 71/71 代表 isolated implementation + tests complete；Phase 4 用于补齐 production wiring、runtime safety、cost governance 与 DOM-anchor + document-order closure。最终完成标准以 Phase 4 checkpoint (Task 38) 为准，不以 Phase 1-3 的 71/71 作为产品收口证据。

- [x] 31. Wire EffectPreviewImagePanel + EffectPreviewScheduleTimeline into production EffectPreviewPanel
  - [x] 31.1 Edit `client/src/pages/autopilot/right-rail/panels/EffectPreviewPanel.tsx` to import `EffectPreviewImagePanel` and `EffectPreviewScheduleTimeline` from `client/src/components/autopilot/`. Mount both inside the existing panel body when `activePreview` is non-null. Derive props from `activePreview`: `architectureSvgDraft`, `imageBase64ByNodeId ?? {}`, `progressPlan`, `dependencyOrder`, `version`, `missionId` (use the job/preview id source already wired into the panel). Do NOT remove the existing progress-plan milestone block; place the new components above or alongside it.
  - [x] 31.2 Gate the `architectureSvgDraft` rendering inside `EffectPreviewImagePanel` so it ONLY renders when Task 34 sanitizer is in place. Until 34 lands, pass `architectureSvgDraft={undefined}` from the production wiring even if the field is present on `activePreview`. After 34 lands, flip to passing the actual sanitized SVG. (See note: 31.2 final-state edit happens AFTER 34.1-34.3 are merged.)
  - [x] 31.3 Add a production integration test at `client/src/pages/autopilot/right-rail/panels/__tests__/EffectPreviewPanel.image-integration.test.tsx`. Render `EffectPreviewPanel` with an `activePreview` containing `imageBase64ByNodeId` (≥2 nodeIds) and `progressPlan` with one running entry. Assert SSR markup contains `data-testid="effect-preview-image-gallery"`, two distinct `data-node-id` attributes, the download button anchor (`data-testid="effect-preview-download-button"`), and the schedule timeline anchor. Use `react-dom/server` `renderToStaticMarkup` per repo convention.
  - _Requirements: 8.2, 8.3, 9.1, 9.2, 15.1, 15.2, 17.1_

- [x] 32. Stage C raster granularity — current preview node only
  - [x] 32.1 Read `server/routes/blueprint.ts` around L13680 (the `buildEffectPreview` Stage C call site) and L10158 (`generateEffectPreviews` Promise.all fan-out). Refactor the Stage C invocation so the raster target list contains ONLY the current `input.node.id`, NOT the full `dependencyOrder.map(entry => entry.nodeId)`. Pass `dependencyOrder` separately as metadata for the schedule timeline / progressPlan, but the `imageApiClient.generate` call set must equal exactly `[input.node.id]` per `buildEffectPreview` invocation.
  - [x] 32.2 Update `ImageService.runStageC` signature/contract if needed: separate `rasterTargets: ReadonlyArray<string>` (the actual generate-call list) from `dependencyOrder` (timeline-only). If the current API conflates them, introduce the split cleanly. Update `image-service.ts` JSDoc to state the new contract.
  - [x] 32.3 Add a server-side integration test at `server/routes/blueprint/effect-preview/__tests__/generate-batch-call-count.test.ts`. Set up 3 distinct target nodes with overlapping dependency chains (e.g., node-A deps [shared-1], node-B deps [shared-1, shared-2], node-C deps [shared-1, shared-3]). Spy on `imageApiClient.generate`. Run `generateEffectPreviews()` end-to-end. Assert `generate.mock.calls.length === 3` (one per target node), NOT 8 or whatever the dependency-chain accumulation would produce. Also assert the called nodeIds are exactly `{node-A, node-B, node-C}` — no shared-1/2/3.
  - [x] 32.4 Verify env-disabled / key-missing / empty-spec fallback paths still produce 0 outgoing calls per affected node (i.e., the call-count guarantee is `≤ N` always, exactly N when all nodes succeed).
  - _Requirements: 1.1, 1.2, 4.1, 4.2, 7.3, 8.1_

- [x] 33. Inject real BlueprintCostTracker into default context
  - [x] 33.1 **Discovery**: Read `server/core/cost-tracker.ts` to determine the actual exported API surface. Document in the test file's preamble: the real method name (`recordCall` / `record` / other), required fields, whether it writes to disk, how to isolate side-effects in tests (in-memory mode? mock factory?). Locate where `costTracker` is currently constructed/used in production (search for `createCostTracker`, `CostTracker`, `recordCall` references). Save discovery findings as a comment at the top of the adapter file.
  - [x] 33.2 Define an adapter at `server/routes/blueprint/effect-preview/cost-tracker-adapter.ts` that wraps the existing `costTracker` and exposes the `BlueprintCostTrackerLike { record({ tier?, durationMs, model, estimatedCost? }): void }` interface that `ImageService` already consumes. The adapter must translate Stage C call metadata into the existing cost system's record format.
  - [x] 33.3 Edit `server/routes/blueprint/context.ts` (around L1470, where the comment "`costTracker` 暂未注入" lives). Replace the comment + un-injected default with: instantiate the cost-tracker-adapter and pass it as `costTracker` to `createImageService(...)`. Remove the "暂未注入" comment.
  - [x] 33.4 Add a context-level test at `server/routes/blueprint/__tests__/context.image-cost-tracking.test.ts`. Build a default `buildBlueprintServiceContext()` (with whatever minimal deps the factory needs), spy on the real cost-tracker method (or use an in-memory implementation if the real one writes to disk), invoke `ctx.effectPreviewImageService.runStageC(...)` with a mocked `imageApiClient` that returns success, and assert the cost tracker recorded N calls with model/durationMs fields populated. Do NOT mock the adapter — test must prove the default production assembly really records cost.
  - _Requirements: 7.3, 8.1_

- [x] 34. SVG architecture draft sanitizer
  - [x] 34.1 Read the existing `server/routes/blueprint/effect-preview/svg-architecture-drafter.ts`. Add a sanitizer step at the END of `draft()`: before returning `{ kind: "ok", svg }`, run the SVG string through a whitelist sanitizer that REMOVES (replaces with empty string or strips entire matched tag): `<script ...>...</script>` blocks (case-insensitive), `<foreignObject ...>` blocks, all `on*=` event-handler attributes (e.g. `onload`, `onclick`, `onerror`), all `javascript:` URL schemes in `href` / `xlink:href`, and any `<a href="http..."` or `<image href="http..."` (external URL). Use a regex-based whitelist approach (no DOM parser dependency). If the sanitizer detects ANY of these, log a warning and proceed with the cleaned string (do NOT switch to `kind: "skipped"` — sanitization is silent).
  - [x] 34.2 Export a pure function `sanitizeSvgArchitectureDraft(svg: string): string` from the same module so tests can target it directly without going through full drafter dependencies.
  - [x] 34.3 Add a focused test at `server/routes/blueprint/effect-preview/__tests__/svg-sanitizer.test.ts` covering: (a) malicious `architectureNotes` containing `<script>alert(1)</script>` produce sanitized SVG with no `<script` substring; (b) `onclick="evil()"` event attribute is stripped; (c) `<a href="javascript:alert(1)">` is stripped or its href is removed; (d) `<foreignObject>` blocks are removed; (e) external URL `<image href="http://attacker.com/x.png">` is stripped; (f) benign SVG (no malicious tokens) passes through unchanged byte-for-byte. Each case asserts the output string does NOT contain the malicious token AND the SVG remains parseable as a string starting with `<svg` and ending with `</svg>`.
  - [x] 34.4 After 34.1-34.3 land, complete Task 31.2's deferred edit: flip `EffectPreviewPanel` production wiring to pass the real (now-sanitized) `activePreview.architectureSvgDraft` instead of `undefined`.
  - _Requirements: 3.1, 3.2, 3.3 (security hardening — newly added)_

- [x] 35. Image settings read-only API + production mount
  - [x] 35.1 Add `GET /api/blueprint/image-settings` route to `server/routes/blueprint.ts` (or a sibling route file if cleaner). The handler reads the resolved `IMAGE_GEN_*` config snapshot via the existing `getResolvedConfig()` from `image-api-client.ts`. Returns JSON `{ baseUrl, model, path, defaultSize, defaultAspect, timeoutMs, maskedApiKey }` where `maskedApiKey` is computed server-side using the same masking rule as `AutopilotImageSettingsPanel` (`apiKey.length >= 14` → 8 head + repeated mask + 6 tail; else `null`). The raw `IMAGE_GEN_API_KEY` MUST NEVER appear in the response body.
  - [x] 35.2 Add a server route test at `server/routes/__tests__/blueprint-image-settings.test.ts` covering: (a) configured key (length ≥14) produces a `maskedApiKey` string with the expected shape; (b) missing key produces `maskedApiKey: null`; (c) the response body string representation does NOT contain the raw test API key value (use a known sentinel value in env stub, then assert `JSON.stringify(body).includes(sentinel) === false`).
  - [x] 35.3 Wire `AutopilotImageSettingsPanel` into the production right rail. Edit `client/src/pages/autopilot/right-rail/panels/EffectPreviewPanel.tsx` (or the appropriate parent slot) to fetch `/api/blueprint/image-settings` on mount, stash the response in component state, and render the panel with the data. Show an "未配置" / loading state while the fetch is in flight. Handle 4xx/5xx errors by hiding the panel with a small inline note (e.g., "无法读取图像服务配置").
  - [x] 35.4 Add a production integration test similar to 31.3 that mocks the fetch, renders the parent panel, and asserts the masked key + config enum values appear in the rendered DOM, AND that no raw key sentinel value appears.
  - _Requirements: 10.1, 10.2, 10.3_

- [x] 36. ProjectCockpitHome timeline — layout-safe slot, no fixed overlay
  - [x] 36.1 Read `client/src/pages/ProjectCockpitHome.tsx`. Locate the existing fixed-position `<ProjectMainChainTimeline>` mount. Replace the fixed-overlay positioning with integration into the existing page header / topbar / layout band — whatever slot Home.tsx already exposes (or add a thin layout-band wrapper if no slot exists). The timeline must NOT use `position: fixed` covering the page top.
  - [x] 36.2 Add a layout regression test at `client/src/pages/__tests__/ProjectCockpitHome.layout.test.tsx` asserting (via SSR string check or DOM structure check): (a) the timeline's container does NOT have `position: fixed` inline style and does NOT have a `top: 0` style covering the viewport; (b) the timeline appears as a child of the page's existing layout container, not as a sibling overlay; (c) the `<Home />` content remains the primary visible region (assert the timeline container width/height is bounded — not 100vw/100vh).
  - _Requirements: 14.4, 17.1_

- [x] 37. Browser-level E2E / screenshot verification (downgraded per 37.3 — Playwright not in repo)
  - [x] 37.1 Add a Playwright test at `e2e/autopilot-effect-preview.spec.ts` (create `e2e/` dir + minimal `playwright.config.ts` if not present; check existing repo first — search for `playwright` in `package.json`). The test starts the dev server (or uses a built static bundle), navigates to a route that surfaces the effect_preview stage with a real or fixture-driven `activePreview` (use a route query param or a test-only fixture seed if needed), and asserts the visible DOM contains: image gallery anchor, at least one `data-node-id` group, the schedule timeline anchor, and the settings panel anchor. Capture a screenshot artifact to `e2e/__screenshots__/autopilot-effect-preview.png`. — **Downgraded per 37.3:** Playwright not installed (workspace-wide grep for `playwright` across all `package.json` files returned 0 matches). Substituted with two artifacts: (1) `server/tests/blueprint-image-settings.smoke.test.ts` — Node HTTP smoke test that boots `createBlueprintRouter()` and asserts `GET /api/blueprint/image-settings` reachability + 7-field shape contract; (2) `client/src/pages/autopilot/right-rail/panels/__tests__/EffectPreviewPanel.production-snapshot.test.tsx` — `react-dom/server` `renderToStaticMarkup` of production `<EffectPreviewPanel>` with Stage C fixture, asserting `data-testid="effect-preview-image-gallery"`, two distinct `data-node-id` groups, `data-testid="effect-preview-schedule-list"`, and `data-testid="effect-preview-download-button"`. All four anchors plus the settings panel anchor (`data-testid="autopilot-image-settings-panel"`) are asserted in one SSR pass after Phase 5 Task 41.1 closed the post-35.3 evidence gap. No screenshot artifact produced.
  - [x] 37.2 Add a Playwright test at `e2e/projects-cockpit-home.spec.ts` navigating to `/projects`. Assert `ProjectMainChainTimeline` is visible (data-component anchor) AND assert the page's primary navigation / header / main-action region is also visible and not occluded by the timeline (use bounding-box overlap checks: `timelineBox.bottom <= navBox.top` OR similar invariant). Capture a screenshot to `e2e/__screenshots__/projects-cockpit-home.png`. — **Downgraded per 37.3:** substituted with `client/src/pages/__tests__/ProjectCockpitHome.production-snapshot.test.tsx` — SSR snapshot asserting both `data-component="project-main-chain-timeline"` AND `data-testid="home-mock"` appear, with the timeline preceding `<Home />` in document order. Document-order is the SSR-equivalent of «timeline does not occlude Home» in normal block flow. Combined with Task 36.2's `position: fixed` regression, covers the Task 37.2 occlusion intent. No bounding-box / computed-CSS / screenshot artifact produced.
  - [x] 37.3 If Playwright is not installed in the repo, do NOT install it as part of this task — instead, downgrade 37.1 and 37.2 to use the existing testing stack (vitest + jsdom would require tooling-chain change, so prefer a lightweight Node-based HTTP smoke test that hits `/api/blueprint/image-settings` and a snapshot of the SSR render of both pages with fixture data). Document the downgrade decision in the task completion report. — **Downgrade decision recorded:** Playwright absence verified by workspace-wide grep across all `package.json` files (`services/lobster-executor` references to `"browser.playwright"` are skill-capability metadata strings, not installed npm packages); no `playwright.config.ts` and no root-level `e2e/` directory exist. Downgrade rationale, scope, and «what is / is not proved» limits documented in the JSDoc preambles of the three new test files (smoke + 2 SSR snapshots) and in the completion report.
  - _Requirements: 9.1, 9.2, 14.4, 17.1_

- [x] 38. Phase 4 final checkpoint
  - [x] 38.1 Run focused server tests: `npx vitest run server/routes/blueprint/effect-preview/ server/routes/__tests__/blueprint-image-settings.test.ts server/routes/blueprint/__tests__/context.image-cost-tracking.test.ts --config vitest.config.server.ts`. All must pass.
  - [x] 38.2 Run focused client tests: `npx vitest run client/src/pages/autopilot/right-rail/panels/__tests__/EffectPreviewPanel.image-integration.test.tsx client/src/pages/__tests__/ProjectCockpitHome.layout.test.tsx`. All must pass.
  - [x] 38.3 Run `node scripts/lint-autopilot-colors.mjs`. Must report 0 violations.
  - [x] 38.4 Run `pnpm run build:pages` (or `npm run build:pages` per repo convention — verify in package.json first). Must succeed.
  - [x] 38.5 If Playwright is in use, run `npx playwright test` and verify the 2 screenshot artifacts exist. If downgraded per 37.3, run the SSR smoke tests.
  - [x] 38.6 Check `node --run check` baseline: confirm no NEW TypeScript errors introduced by Phase 4 beyond the documented 2 pre-existing baseline errors. Repo-wide typecheck baseline is NOT a sole completion signal — the production-path tests in 38.1-38.5 are the binding signal.
  - [x] 38.7 Document the final closure: update the existing `## Notes` section's count from "80 leaf sub-tasks" to the new Phase 4-inclusive total. Add a one-line summary of Phase 4's scope.


## Phase 5: Audit Hardening

> Phase 5 closes the evidence gaps the post-Phase-4 audit identified. Scope is bounded by the existing repository toolchain — no new test runners, sanitizer libraries, or DOM harnesses are introduced. Items that genuinely require those tools (real-browser visual verification, useEffect/DOM execution harness, parser-based SVG whitelist) are explicitly registered as residual risks in the Notes section, not silently absorbed into a "passed" claim. Phase 5 is the binding signal for the spec's product-closure status; if any of 39-46 is `[ ]`, the spec is NOT closed regardless of Phase 1-4 totals.

- [x] 39. Restore spec typecheck baseline
  - [x] 39.1 Fix `client/src/components/autopilot/__tests__/EffectPreviewScheduleTimeline.test.tsx` framer-motion mock typing without changing runtime assertions. The 3 errors are: (a) `JSX namespace not found` on line 62, (b) `'Tag' element type does not have construct/call signatures` on line 64, (c) `'Tag' cannot be used as a JSX component` on line 64. The current pattern uses `Proxy` over `motion` returning components keyed by string tag. Likely fix: replace `keyof JSX.IntrinsicElements` with an inline string-literal union OR `keyof React.JSX.IntrinsicElements` (React 19 namespace), and assert `Tag` as `React.ComponentType<...>` or use `createElement(tag, ...)` instead of `<Tag>` JSX shorthand. Preserve test assertions byte-for-byte.
    - File: `client/src/components/autopilot/__tests__/EffectPreviewScheduleTimeline.test.tsx`
    - _Requirements: 38.6 (audit-corrected baseline)_
  - [x] 39.2 Run `node --run check` and capture the FULL stdout/stderr. Confirm only the 2 documented external baseline errors remain (`SpecDocsProgressPanel.tsx` JSX namespace + `MarkdownRenderer.mermaid.test.tsx` locale literal). Paste the exact error lines into the task completion report. If any other error survives, investigate before flipping the box.
    - _Requirements: 38.6_

- [x] 40. Add real route-level generateEffectPreviews regression
  - [x] 40.1 Build a minimal route/job fixture that reaches the production `generateEffectPreviews` path. Read `server/routes/blueprint.ts` around L10158 (the `Promise.all(targetNodes.map(buildEffectPreview))` fan-out). Two viable approaches:
    (a) Export `generateEffectPreviews` as a named test-only export (clean), OR
    (b) Use the existing `POST /api/blueprint/jobs/.../effect-previews` HTTP route via supertest-style express test (mirrors `blueprint-routes.test.ts` pattern). Pick whichever is less invasive — option (a) is cleaner if `generateEffectPreviews` is a top-level function; option (b) is the closest to the audit's "route-level" intent. Document the choice in the test preamble.
    - File: `server/routes/blueprint/effect-preview/__tests__/generate-batch-call-count.route.test.ts` (NEW file; does NOT replace the existing `generate-batch-call-count.test.ts` — that one stays as `runStageC` contract coverage, see 40.3)
    - _Requirements: 1.1, 1.2, 4.1, 4.2, 7.3, 8.1 (audit-corrected: route-level proof)_
  - [x] 40.2 Spy `imageApiClient.generate` (or stub `globalThis.fetch` if the production path uses the real `createImageApiClient`) at the boundary. Drive 3 distinct target nodes through the route fixture with overlapping dependency chains. Assert: (a) `generate.mock.calls.length === 3`, NOT 8 or whatever the chain accumulation would produce; (b) called nodeIds are exactly `{node-A, node-B, node-C}` — no `shared-1/2/3`; (c) the response artifact contains `imageBase64ByNodeId` keyed only by the 3 target nodes.
    - _Requirements: 4.1, 4.2_
  - [x] 40.3 Keep the existing `generate-batch-call-count.test.ts` as lower-level `runStageC` contract coverage. Add a comment at the top of THAT file (NEW comment, not regenerating) cross-referencing the new route-level test as the binding production-path proof.
    - File: `server/routes/blueprint/effect-preview/__tests__/generate-batch-call-count.test.ts` (1-block JSDoc append only; do not touch test bodies)
    - _Requirements: 32.3 (audit-corrected)_

- [x] 41. Repair production snapshot closure evidence
  - [x] 41.1 Update `client/src/pages/autopilot/right-rail/panels/__tests__/EffectPreviewPanel.production-snapshot.test.tsx`:
    - Pass `initialImageSettings={...}` (a ready-state ImageSettingsViewModel fixture) to the panel render so the settings panel mounts in the same SSR pass as gallery + schedule timeline.
    - Add an assertion that `data-testid="autopilot-image-settings-panel"` appears in the markup alongside `data-testid="effect-preview-image-gallery"` and `data-testid="effect-preview-schedule-list"` — all three anchors in ONE render confirms the cockpit closure.
    - Assert sentinel raw-key non-leak (reuse `SENTINEL-RAW-KEY-NEVER-EXPOSE` pattern).
    - _Requirements: 9.1, 9.2, 17.1_
  - [x] 41.2 Remove stale comments. Edit BOTH:
    (a) The existing JSDoc preamble of `EffectPreviewPanel.production-snapshot.test.tsx` that says "Settings panel anchor intentionally NOT asserted because Task 35.3 is still unchecked". Replace with: "All three anchors (gallery / schedule / settings) are asserted in one production render — this is the post-35.3 closure proof."
    (b) The Task 37.1 description in `tasks.md` that contains the same stale text. Update the inline downgrade rationale to reflect the current state.
    - _Requirements: 37.1 (post-35.3 closure)_

- [x] 42. Settings response mapping hardening
  - [x] 42.1 Extract a pure helper `mapImageSettingsResponseToViewModel(body): ImageSettingsViewModel` from `EffectPreviewPanel.tsx`'s `useEffect` body. Place it in a new module so both the production component and a unit test can import it directly without going through the panel:
    - File: `client/src/lib/autopilot/image-settings-mapper.ts` (NEW)
    - Exports: `mapImageSettingsResponseToViewModel(body: unknown): ImageSettingsViewModel | null`
    - The helper validates the response shape (typeof checks on each of the 7 fields), returns `null` on malformed input (any field missing or wrong type), and on valid input returns the same viewModel that the existing `useEffect` constructs.
    - Update `EffectPreviewPanel.tsx`'s `useEffect` to call this pure helper instead of inlining the field copy. Behavior must be unchanged.
    - _Requirements: 10.1, 10.2 (audit-corrected: real fetch link evidence)_
  - [x] 42.2 Unit test the pure helper at `client/src/lib/autopilot/__tests__/image-settings-mapper.test.ts`:
    - **Valid mapping**: full server response → expected view-model (assert all 7 fields copied, especially `body.maskedApiKey` → `viewModel.apiKey`).
    - **Malformed responses**: missing field, wrong type (e.g. `timeoutMs: "60000"` string instead of number), `null`, `undefined` → returns `null`.
    - **Sentinel non-leak**: even when input contains a raw `apiKey` field (which the server contract does NOT send, but defense-in-depth), output's `apiKey` field equals `body.maskedApiKey`, NOT the rogue raw value.
    - _Requirements: 10.1, 10.2, 10.3_
  - [x] 42.3 Add a JSDoc preamble comment in `image-settings-mapper.test.ts` explicitly documenting:
    - **What this test PROVES**: the response → view-model field copy logic is correct in isolation, sentinel raw-key cannot end up in `viewModel.apiKey` even via attempted bypass.
    - **What this test does NOT prove**: real `useEffect` execution under React runtime (no DOM harness), real network round-trip, error-state UI rendering after a failed fetch. These remain residual risks tracked in Notes section per Task 45.2.
    - _Requirements: 10.x (residual-risk transparency)_

- [x] 43. Honest image cost reporting
  - [x] 43.1 Add image model pricing to `shared/cost.ts`. Read the existing `PRICING_TABLE` shape first. Add per-call estimated pricing entries for the 4 image models in the spec's `IMAGE_GEN_MODEL` enum: `gpt-image-2`, `gemini-2.5-flash-image`, `gemini-3.1-flash-image-preview`, `gemini-3-pro-image-preview`. Use a per-call flat rate (not per-token) since image generation is billed per output. If you don't have authoritative pricing, use a documented STATIC ESTIMATE (e.g., $0.04 per image as a conservative gpt-image-2 rate per OpenAI public pricing) and add a JSDoc comment citing the source/date and noting the value is an estimate to be refreshed when actual billing data lands. The IMPORTANT thing is that `actualCost > 0` for successful image calls, not that the value is precise.
    - File: `shared/cost.ts`
    - _Requirements: 7.3 (audit-corrected: cost-into-system semantic)_
  - [x] 43.2 Compute `estimatedCost` in `image-service.ts`'s `runRasterPipeline`:
    - On success: `estimatedCost = lookupImagePricing(model)` (a new helper exported from `shared/cost.ts` that returns the static per-call rate). Pass into `costTracker.record(...)`.
    - On failure: `estimatedCost = 0` (no charge for failed calls — this is the only case where 0 is the honest answer). Pass `0` explicitly so the adapter knows it's not "missing data" but "free".
    - File: `server/routes/blueprint/effect-preview/image-service.ts` around L485
    - _Requirements: 7.3_
  - [x] 43.3 Update `cost-tracker-adapter.ts` to honor the explicit `estimatedCost`:
    - Today: `actualCost: input.estimatedCost ?? 0`. Change to: `actualCost: input.estimatedCost ?? 0` BUT add a defensive check — if `tier === undefined` (success path) AND `estimatedCost === 0`, log a `console.warn` saying "image-cost-adapter: success-path call recorded $0 — pricing source likely missing for model X". This makes silent under-reporting visible.
    - File: `server/routes/blueprint/effect-preview/cost-tracker-adapter.ts`
    - _Requirements: 7.3, 8.1_
  - [x] 43.4 Update `context.image-cost-tracking.test.ts`:
    - Success-path test must now assert `record.actualCost > 0` AND equals the lookup result for `model: "gpt-image-2"`.
    - Timeout-path test must still assert `record.actualCost === 0` (failure case is honest 0).
    - Add a third test case: success path with an unknown model (e.g. mock a fake `model` value not in `PRICING_TABLE`) → asserts the warn-on-zero branch fires (use `vi.spyOn(console, "warn")`).
    - File: `server/routes/blueprint/__tests__/context.image-cost-tracking.test.ts`
    - _Requirements: 7.3_

- [x] 44. Client SVG defense-in-depth
  - [x] 44.1 Move `sanitizeSvgArchitectureDraft` to a shared module so server + client can both import it without circular dependency.
    - Read the existing module: `server/routes/blueprint/effect-preview/svg-architecture-drafter.ts`.
    - Create new shared module: `shared/blueprint/svg-sanitizer.ts` containing:
      - The pure `sanitizeSvgArchitectureDraft(svg: string): string` function (lifted verbatim, including the optional logger param).
      - The `SvgArchitectureSanitizerLogger` interface.
    - Re-export from `svg-architecture-drafter.ts` to maintain backward compat (so existing server imports keep working without rewrite).
    - File: `shared/blueprint/svg-sanitizer.ts` (NEW), `server/routes/blueprint/effect-preview/svg-architecture-drafter.ts` (re-export only)
    - _Requirements: 3.1, 3.2 (defense-in-depth)_
  - [x] 44.2 Server drafter + client `EffectPreviewImagePanel.tsx` both sanitize before render:
    - Server drafter currently calls `sanitizeSvgArchitectureDraft` once. Keep that.
    - Client `EffectPreviewImagePanel.tsx` line 341 currently does `dangerouslySetInnerHTML={{ __html: architectureSvgDraft }}`. Change to `dangerouslySetInnerHTML={{ __html: sanitizeSvgArchitectureDraft(architectureSvgDraft) }}` — import from `@shared/blueprint/svg-sanitizer`.
    - This catches: legacy artifacts persisted before the server sanitizer landed; test fixtures that hand-craft `architectureSvgDraft`; any future server-side bypass.
    - File: `client/src/components/autopilot/EffectPreviewImagePanel.tsx`
    - _Requirements: 3.1, 3.2 (defense-in-depth)_
  - [x] 44.3 Add a client-side test that hands a malicious `architectureSvgDraft` directly to the panel (bypassing the server) and asserts the rendered output is stripped:
    - File: `client/src/components/autopilot/__tests__/EffectPreviewImagePanel.client-sanitize.test.tsx` (NEW)
    - Render `<EffectPreviewImagePanel>` via `renderToStaticMarkup` with `architectureSvgDraft = '<svg onclick="evil()"><script>alert(1)</script><circle/></svg>'`.
    - Assert the SSR markup does NOT contain `<script` or `onclick=` substrings, AND DOES contain `<circle`. This proves the client tier strips even when the server tier never ran.
    - _Requirements: 3.1, 3.2_

- [x] 45. Residual risk wording correction
  - [x] 45.1 In `tasks.md` Notes section, replace the phrase `"browser-visible closure"` (in the Phase 4 closure paragraph) with `"DOM-anchor + document-order closure"`. Also update the corresponding Task 38.7 closure summary if it mentions the same phrase.
    - _Requirements: closure honesty_
  - [x] 45.2 Add a `### Residual risks (post-Phase 4 audit)` sub-section to Notes listing 7 items (verbatim):
    1. **No real-browser screenshot or computed-CSS verification.** Playwright is not in the repo; SSR `renderToStaticMarkup` proves anchor presence and document order, NOT actual browser layout, paint, stacking context, or mobile-breakpoint visibility.
    2. **No `useEffect` / DOM harness.** Settings panel's mount-time fetch is unit-tested at the pure-mapper level (Task 42), not as a real React effect under jsdom. Production fetch round-trip remains structurally unverified.
    3. **Regex SVG sanitizer, not a parser whitelist.** `sanitizeSvgArchitectureDraft` is regex-based; it can be bypassed by entity-encoded schemes, `style=` URL constructs, or unanticipated SVG dynamic loads. Defense-in-depth (server + client both sanitize) reduces but does not eliminate this risk. A future migration to `DOMPurify` or a parser-based whitelist would be the proper fix.
    4. **Image cost is a static estimate, not actual billing.** Task 43.1 uses a documented static estimate per model; real per-call cost depends on output size, retries, provider-specific surcharges. Refresh when authoritative billing data lands.
    5. **Generated batch test coverage.** Task 40 covers the `generateEffectPreviews` route fan-out. It does NOT cover concurrent-job race conditions, partial failure mid-batch with rollback, or queue back-pressure under sustained load.
    6. **No visual regression for ProjectCockpitHome layout band.** Task 36 + SSR document-order proves structural intent. Real mobile breakpoints, RTL, dark mode, and reduced-motion contexts are unverified.
    7. **Pre-existing 2-error TS baseline outside this spec.** `SpecDocsProgressPanel.tsx` JSX namespace + `MarkdownRenderer.mermaid.test.tsx` locale literal are owned by other specs. They block `node --run check` from being green; this spec's contract is "do not introduce new errors", not "fix repo-wide baseline".
    - _Requirements: closure honesty_

- [x] 46. Phase 5 final checkpoint
  - [x] 46.1 Run focused server tests covering Tasks 40, 43:
    - `npx vitest run server/routes/blueprint/effect-preview/__tests__/generate-batch-call-count.route.test.ts server/routes/blueprint/__tests__/context.image-cost-tracking.test.ts --config vitest.config.server.ts`
    - All must pass. Capture pass count.
    - _Requirements: 32.3, 7.3_
  - [x] 46.2 Run focused client tests covering Tasks 41, 42, 44:
    - `npx vitest run client/src/pages/autopilot/right-rail/panels/__tests__/EffectPreviewPanel.production-snapshot.test.tsx client/src/lib/autopilot/__tests__/image-settings-mapper.test.ts client/src/components/autopilot/__tests__/EffectPreviewImagePanel.client-sanitize.test.tsx`
    - All must pass. Capture pass count.
    - _Requirements: 9.1, 10.1, 3.1_
  - [x] 46.3 Run `node --run check` and verify EXACTLY 2 baseline errors remain:
    - `client/src/pages/autopilot/right-rail/spec-docs-progress/SpecDocsProgressPanel.tsx(278,42)` — JSX namespace
    - `client/src/pages/autopilot/right-rail/streaming-doc/__tests__/MarkdownRenderer.mermaid.test.tsx(43,69)` — locale literal
    - Paste the EXACT stdout error lines into the completion report. If MORE than 2 errors appear, the checkpoint fails — do NOT flip the box. If FEWER than 2 (i.e., a baseline got accidentally fixed), document and proceed.
    - _Requirements: 38.6 (audit-corrected baseline)_
  - [x] 46.4 Update `tasks.md` Notes section: revise the Phase 4 closure paragraph (per Task 45.1) and confirm the residual-risks list (per Task 45.2) is in place. Update the bullet about leaf counts (now 46 epics + 96 leaf sub-tasks = 142 checkboxes — per recount during Wave 14 closure).
    - _Requirements: closure honesty_
  - [x] 46.5 Final attestation: write a Phase 5 closure paragraph in Notes (alongside the Phase 4 one) summarizing what Phase 5 closed: typecheck-baseline restoration, route-level fan-out proof, snapshot anchor coverage, settings-mapper unit, cost honesty, client SVG defense-in-depth, residual-risks register. Use the exact phrase "DOM-anchor + document-order closure" if referencing visual closure. Do NOT use "browser-visible closure" anywhere.
    - _Requirements: closure honesty_

## Notes

## Phase 4 closure (final, 2026-05-27)

Phase 4 proved end-to-end production wiring of the Stage C image rendering pipeline: real `EffectPreviewImagePanel` + `EffectPreviewScheduleTimeline` mounted into the production `EffectPreviewPanel`, raster granularity fixed to one `imageApiClient.generate` call per current preview node (no dependency-chain accumulation), real `BlueprintCostTracker` injected into the default context, SVG architecture draft sanitizer (script / foreignObject / on-event / javascript: / external-href stripping), read-only `/api/blueprint/image-settings` API with server-side key masking, `ProjectMainChainTimeline` integrated into the layout band without `position: fixed` overlay, and DOM-anchor + document-order closure delivered as Node HTTP smoke + 2 SSR `renderToStaticMarkup` snapshots (Playwright downgraded per 37.3 — not in repo).

### Residual risks (post-Phase 4 audit)

1. **No real-browser screenshot or computed-CSS verification.** Playwright is not in the repo; SSR `renderToStaticMarkup` proves anchor presence and document order, NOT actual browser layout, paint, stacking context, or mobile-breakpoint visibility.
2. **No `useEffect` / DOM harness.** Settings panel's mount-time fetch is unit-tested at the pure-mapper level (Task 42), not as a real React effect under jsdom. Production fetch round-trip remains structurally unverified.
3. **Regex SVG sanitizer, not a parser whitelist.** `sanitizeSvgArchitectureDraft` is regex-based; it can be bypassed by entity-encoded schemes, `style=` URL constructs, or unanticipated SVG dynamic loads. Defense-in-depth (server + client both sanitize) reduces but does not eliminate this risk. A future migration to `DOMPurify` or a parser-based whitelist would be the proper fix.
4. **Image cost is a static estimate, not actual billing.** Task 43.1 uses a documented static estimate per model; real per-call cost depends on output size, retries, provider-specific surcharges. Refresh when authoritative billing data lands.
5. **Generated batch test coverage.** Task 40 covers the `generateEffectPreviews` route fan-out. It does NOT cover concurrent-job race conditions, partial failure mid-batch with rollback, or queue back-pressure under sustained load.
6. **No visual regression for ProjectCockpitHome layout band.** Task 36 + SSR document-order proves structural intent. Real mobile breakpoints, RTL, dark mode, and reduced-motion contexts are unverified.
7. **Pre-existing 2-error TS baseline outside this spec.** `SpecDocsProgressPanel.tsx` JSX namespace + `MarkdownRenderer.mermaid.test.tsx` locale literal are owned by other specs. They block `node --run check` from being green; this spec's contract is "do not introduce new errors", not "fix repo-wide baseline".

## Phase 5 closure (final, 2026-05-27)

Phase 5 closed 7 audit-driven gaps on top of Phase 4: typecheck-baseline restoration (Task 39 — 3 JSX-namespace errors in `EffectPreviewScheduleTimeline.test.tsx` fixed; `node --run check` returns exactly 2 unrelated baseline errors); route-level `generateEffectPreviews` fan-out proof (Task 40 — `generate-batch-call-count.route.test.ts` asserts N targets ⇒ N calls at the production fan-out boundary); production-snapshot anchor coverage including the `autopilot-image-settings-panel` data-testid (Task 41); pure settings-mapper unit (Task 42 — `image-settings-mapper.ts` with 29 unit tests covering maskedApiKey, fallback, sentinel non-leak); honest image cost reporting (Task 43 — `IMAGE_PRICING_TABLE` + `lookupImagePricing` in `shared/cost.ts`, real estimatedCost in `image-service.ts`, defensive console.warn in adapter); client SVG defense-in-depth (Task 44 — `shared/blueprint/svg-sanitizer.ts` lifted from server, client `EffectPreviewImagePanel` sanitizes before `dangerouslySetInnerHTML`); residual-risks register (Task 45 — 7 explicit risks documented). The DOM-anchor + document-order closure remains the binding visual evidence; real-browser screenshot or computed-CSS verification is not delivered in this spec and remains an explicit residual risk.

- 本计划由 142 个 checkbox 组成（46 个 epic 章节 + 96 个 leaf sub-tasks），覆盖 Phase 1: 1-14、Phase 2: 15-21、Phase 3: 22-27、Cross-phase: 28-30、Phase 4: 31-38、Phase 5: 39-46。Phase 4 共 31 个 leaf sub-tasks，是 production wiring + runtime safety + cost governance + DOM-anchor + document-order closure 收口阶段，所有测试 sub-task 均为必需（无 `*` 标记）。Phase 5 共 24 个 leaf sub-tasks，是 audit hardening 阶段（typecheck baseline / route-level proof / snapshot anchor coverage / settings mapper unit / cost honesty / client SVG defense-in-depth / residual-risks register），所有 sub-task 均为必需
- 实现语言：TypeScript（与设计文档与仓库现有约定一致）
- Tasks 标记 `*` 的为 optional 测试任务，可为快速 MVP 跳过；`12.x` 与 `19.1` 是 PBT，使用 fast-check ≥ 100 numRuns；`13.x`、`20.x`、`26.x` 是 example / 集成测试
- 软耦合策略：Phase 1+3 组件统一从 `visual-tokens-placeholder` 取色，Phase 2 上线时只替换该文件内容即可全局生效
- 单一 fetch 真相源：`ImageApiClient.generate()` 是唯一 outgoing image API 调用点；浏览器侧从不直连 `IMAGE_GEN_BASE_URL`
- 制品分离：`architectureSvgDraft` / `imageBase64ByNodeId` / `textOnlyEffectPreview` 三类制品在 `BlueprintEffectPreview` 上各占独立字段，禁止混入同一字段
- 串行节点出图：`n` 强制为 1，禁止批量；image edit `/v1/image/edit` 不在本 spec 范围
- Property tagging convention：所有 PBT 必须以 `Feature: autopilot-image-rendering-and-visual-system, Property <n>: <text>` 形式打 tag
- DAG 设计：Phase 1 内部高度串行（types → API client → templates/SVG/scheduler → ImageService → wiring），Phase 2 高度串行（tokens → placeholder → components），Phase 3 在 placeholder 之后可三组件并行；Phase 1 + Phase 2 + Phase 3 的早期任务可跨 phase 并行启动

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "3.1", "4.1", "8.1", "15.1"] },
    { "id": 1, "tasks": ["2.1", "5.1", "12.1", "16.1", "19.1"] },
    { "id": 2, "tasks": ["2.2", "5.2", "11.1", "17.1", "18.1", "22.1", "23.1", "24.1"] },
    { "id": 3, "tasks": ["2.3", "9.1", "10.1", "12.5", "20.1", "20.2", "22.2", "25.1", "26.1", "26.2"] },
    { "id": 4, "tasks": ["6.1", "12.2", "12.6", "12.8", "13.2"] },
    { "id": 5, "tasks": ["6.2", "12.3", "12.7"] },
    { "id": 6, "tasks": ["7.1", "12.4", "13.1"] },
    { "id": 7, "tasks": ["28.1", "29.1"] },
    { "id": 8, "tasks": ["31.1", "31.3", "32.1", "32.2", "33.1", "34.1", "34.2"] },
    { "id": 9, "tasks": ["32.3", "32.4", "33.2", "33.3", "33.4", "34.3", "34.4", "31.2", "35.1", "35.2", "36.1"] },
    { "id": 10, "tasks": ["35.3", "35.4", "36.2", "37.1", "37.2", "37.3"] },
    { "id": 11, "tasks": ["38.1", "38.2", "38.3", "38.4", "38.5", "38.6", "38.7"] },
    { "id": 12, "tasks": ["39.1", "39.2", "40.1", "40.2", "40.3", "41.1", "41.2"] },
    { "id": 13, "tasks": ["42.1", "42.2", "42.3", "43.1", "43.2", "43.3", "43.4", "44.1", "44.2", "44.3"] },
    { "id": 14, "tasks": ["45.1", "45.2", "46.1", "46.2", "46.3", "46.4", "46.5"] }
  ]
}
```
