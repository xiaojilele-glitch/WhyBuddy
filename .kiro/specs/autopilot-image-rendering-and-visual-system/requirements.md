# Requirements Document

## Introduction

`autopilot-image-rendering-and-visual-system` 是一个跨三阶段的合并式 mega-spec，覆盖 `WhyBuddy` 自动驾驶产品线在「effect preview 真实图像渲染」「Sora 风格视觉令牌系统」「项目主链进度时间线」三条主线上的统一交付。三个阶段在 DAG 中可并行执行，但 Phase 1 和 Phase 3 的可视化输出必须最终消费 Phase 2 提供的视觉令牌。

Phase 1 的 effect preview 图像渲染被严格定义为现有「input → clarification → route」「spec_tree → spec_documents」两段流水线之后的第三段流水线 Stage C，整段管线为 `spec_documents → prompt template → SVG architecture draft → schedule plan → gpt-image-2 raster output`。图像 API 调用是 Stage C 的最末一步，且仅在 spec 文档完整时才被触发。Phase 1 显式排除 image edit 多部分上传 `/v1/image/edit`，留给后续 spec。

Phase 2 仅覆盖视觉令牌，不重写 `MermaidBlock`，后者归属现有 `autopilot-mermaid-diagram-rendering` spec。

Phase 3 挂载在 `ProjectCockpitHome` 而非 `AutopilotRoutePage`，承载主链 6 步时间线、effect preview 调度时间线与项目能力快照角标。

Required Reference：`docs/assets/imageTest(2).html`。该参考文件包含已在浏览器端验证可用的 image API 协议（请求/响应字段、模型枚举、路径兼容、错误码、Bearer 认证、conic-gradient loading orb CSS、最近 24 张历史 IndexedDB 策略），所有 Phase 1 的图像生成请求/响应/降级行为必须与该参考文件保持一致。

## Glossary

- **System**: 整个 `autopilot-image-rendering-and-visual-system` 范围内的复合系统，包含服务端图像服务、客户端图像面板、视觉令牌库、主链时间线组件等子系统。
- **ImageService**: 服务端编排器，位于 `server/routes/blueprint/effect-preview/image-service.ts`，负责按节点串行调用 `ImageApiClient` 并将结果写入 `BlueprintEffectPreview` 制品。
- **ImageApiClient**: 服务端 image API 客户端，位于 `server/routes/blueprint/effect-preview/image-api-client.ts`，是唯一持有 `IMAGE_GEN_API_KEY` 的模块，浏览器侧不可见。
- **PromptTemplateLibrary**: 4 个风格槽位的提示词模板库（`system architecture diagram` / `UI mockup` / `concept sketch` / `product hero`），输入为 spec 文档，输出为最终送达 image API 的 prompt 字符串。
- **SvgArchitectureDrafter**: 在调用栅格 image API 之前生成 SVG 架构草图作为中间制品的子系统，输入为 `architectureNotes`，输出 SVG 字符串。
- **EffectPreviewScheduler**: 排程器，根据节点 `dependencyOrder[]` 决定哪些节点进入 `progressPlan[]` 并按顺序生成图像。
- **BlueprintEffectPreview**: 现有 effect preview 制品壳，base64 图像数据将以新增字段写入该制品，而非浏览器 `localStorage`。
- **BlueprintCostTracker**: 已存在的成本治理记录器，每次 image API 调用必须把 token / 调用计数挂入。
- **EffectPreviewImagePanel**: 客户端组件，文件 `client/src/components/autopilot/EffectPreviewImagePanel.tsx`，挂在 autopilot 右侧 rail 在 `activeStageKey === "effect_preview"` 时渲染。
- **ImageGalleryCache**: 客户端 IndexedDB 缓存，最多保留最近 24 张图像 base64，避免节点切换重复拉取。
- **AutopilotImageSettingsPanel**: 客户端图像设置面板，展示 `IMAGE_GEN_*` 环境变量状态与脱敏后的 API key。
- **VisualTokens**: 视觉令牌模块，文件 `client/src/lib/autopilot/visual-tokens.ts`，提供 7 层 OKLCH 调色板（entry / frontend / backend-core / AI-capability / governance / business-loop / data-state / external-integration）的 light + dark 双主题取值。
- **HorizontalCrossCutBar**: 客户端组件，水平展示跨切关注点链路（如 `BlueprintEventBus → BlueprintSocketRelay → useBlueprintRealtimeStore`）。
- **CodeBoundarySidebar**: 客户端组件，依据 spec node 的 `codePaths` 元数据，在 `design.md` 旁列出真实代码目录路径。
- **ProjectMainChainTimeline**: 客户端组件，渲染 `Project → Clarification → Spec → Route → Execution → Evidence` 6 步主链时间线。
- **EffectPreviewScheduleTimeline**: 客户端组件，挂在 effect_preview 右侧 rail 槽位，消费 `BlueprintEffectPreview.progressPlan[]` 与 `dependencyOrder[]`。
- **CapabilitySnapshotBadges**: 客户端组件，在 `ProjectCockpitHome` 顶栏展示静态项目能力角标（`14 shared contracts | 77 specs | 5 capability bridges | Mission/Browser/Docker runtimes`）。
- **FallbackTier**: image API 6 级降级层级，按顺序为 `env disabled → key missing → timeout → quota → moderation → upstream failure`。
- **TextOnlyEffectPreview**: 任意 fallback 触发后，effect preview 退化为仅文本的最终展示形态。
- **ImageGenConfig**: 7 个新增环境变量 `IMAGE_GEN_API_KEY` / `IMAGE_GEN_BASE_URL` / `IMAGE_GEN_MODEL` / `IMAGE_GEN_PATH` / `IMAGE_GEN_DEFAULT_SIZE` / `IMAGE_GEN_DEFAULT_ASPECT` / `IMAGE_GEN_TIMEOUT_MS`。
- **ProjectCockpitHome**: 现有项目驾驶舱首页，挂载点为 `client/src/pages/ProjectCockpitHome.tsx`。

## Requirements

### Requirement 1: Phase 1 Stage C 流水线编排

**User Story:** As an autopilot user 等待 effect preview 出图, I want 图像生成在 spec 文档完整后按固定四步流水线推进, so that 每一张图都来自结构化输入而非裸 prompt。

#### Acceptance Criteria

1. WHEN spec_documents 写入完成事件到达 ImageService, THE ImageService SHALL 依次执行 prompt template 套用、SVG architecture draft 生成、schedule plan 排程、gpt-image-2 栅格调用四个步骤。
2. IF spec_documents 缺失或为空, THEN THE ImageService SHALL 跳过 Stage C 并写入 `TextOnlyEffectPreview` 标记。
3. THE ImageService SHALL 把 SVG architecture draft 作为命名为 `architectureSvgDraft` 的中间制品持久化到 `BlueprintEffectPreview`，与栅格图分开存储。
4. WHEN ImageService 启动单次节点处理, THE ImageService SHALL 把 `n` 字段固定为 `1`，禁止批量出图。

### Requirement 2: Phase 1 提示词模板库

**User Story:** As an autopilot 开发者, I want 4 个稳定风格槽位映射到 spec 文档, so that 不同节点的图像具有一致的视觉语言。

#### Acceptance Criteria

1. THE PromptTemplateLibrary SHALL 提供 `system architecture diagram`、`UI mockup`、`concept sketch`、`product hero` 四个风格模板。
2. WHEN PromptTemplateLibrary 被调用, THE PromptTemplateLibrary SHALL 接收 spec 文档结构化字段并输出最终 prompt 字符串。
3. IF spec 文档未指定风格, THEN THE PromptTemplateLibrary SHALL 默认使用 `system architecture diagram` 模板。
4. THE PromptTemplateLibrary SHALL 在每条 prompt 前置统一元信息以保证风格一致。

### Requirement 3: Phase 1 SVG 架构草图中间步骤

**User Story:** As a 评审者, I want 在栅格图生成之前先看到 SVG 架构草图, so that 可在低成本阶段及时发现结构错误。

#### Acceptance Criteria

1. WHEN ImageService 进入 SVG draft 阶段, THE SvgArchitectureDrafter SHALL 读取 `architectureNotes` 字段并产出 SVG 字符串。
2. IF SvgArchitectureDrafter 失败, THEN THE ImageService SHALL 跳过 SVG 阶段并继续推进栅格阶段，同时记录降级原因。
3. THE SvgArchitectureDrafter SHALL 把生成的 SVG 字符串作为独立制品字段写入 `BlueprintEffectPreview`，不混入栅格 base64 字段。

### Requirement 4: Phase 1 排程器与节点串行

**User Story:** As an autopilot 用户, I want 节点出图按依赖顺序串行进行且单点失败不阻断其他节点, so that 图像产出可预测、可追溯。

#### Acceptance Criteria

1. THE EffectPreviewScheduler SHALL 基于 `dependencyOrder[]` 生成 `progressPlan[]` 并按该顺序串行处理节点。
2. WHEN 单个节点的图像生成失败, THE EffectPreviewScheduler SHALL 标记该节点失败并继续处理下一个节点。
3. THE EffectPreviewScheduler SHALL 在 `BlueprintEffectPreview.progressPlan[]` 中记录每个节点的状态、起始时间、结束时间与降级层级。

### Requirement 5: Phase 1 gpt-image-2 协议合规

**User Story:** As a 服务端开发者, I want 服务端图像调用与 imageTest(2).html 已验证的协议完全一致, so that 不引入未验证的字段并复用 whybuddy 已知的代理拓扑。

#### Acceptance Criteria

1. WHEN ImageApiClient 发起请求, THE ImageApiClient SHALL 在请求体内提供 `model`、`prompt`、`response_format = "b64_json"`、`image_size`、`aspect_ratio`、`n = 1` 六个字段。
2. THE ImageApiClient SHALL 将 `image_size` 限制在 `"1K" | "2K" | "4K" | "512"` 集合内，并将 `aspect_ratio` 限制在 `"1:1" | "2:3" | "3:2" | "auto"` 集合内。
3. THE ImageApiClient SHALL 将 `model` 限制在 `gpt-image-2`、`gemini-2.5-flash-image`、`gemini-3.1-flash-image-preview`、`gemini-3-pro-image-preview` 集合内。
4. THE ImageApiClient SHALL 通过 `Authorization: Bearer <IMAGE_GEN_API_KEY>` 头完成认证。
5. WHERE `IMAGE_GEN_PATH` 配置为 `/v1/image/created`, THE ImageApiClient SHALL 使用旧版兼容路径，否则使用 `/v1/images/generations`。
6. WHEN 响应返回成功, THE ImageApiClient SHALL 从 `json.data[0].b64_json` 与 `json.data[0].mime_type` 字段读取图像数据。
7. IF 响应包含 `AGENT_DOMAIN_MISMATCH` 或 `OPENAI_IMAGE_EDIT_FAILED` 错误码, THEN THE ImageApiClient SHALL 在错误日志中保留原错误码并交由 ImageService 进入降级。

### Requirement 6: Phase 1 六级降级与文本兜底

**User Story:** As an autopilot 用户, I want 图像生成在任意失败场景下都能退回到文本预览, so that effect preview 不会因为图像问题而完全失效。

#### Acceptance Criteria

1. THE ImageService SHALL 按 `env disabled → key missing → timeout → quota → moderation → upstream failure` 顺序识别并标记降级层级。
2. IF `IMAGE_GEN_API_KEY` 未配置, THEN THE ImageService SHALL 立即触发 `key missing` 层级并跳过网络调用。
3. WHILE 单次调用耗时超过 `IMAGE_GEN_TIMEOUT_MS`, THE ImageApiClient SHALL 中止请求并向 ImageService 报告 `timeout` 层级。
4. WHEN 任意一个降级层级被触发, THE ImageService SHALL 写入 `TextOnlyEffectPreview` 兜底数据，并在 `BlueprintEffectPreview` 中记录触发的层级名称与错误摘要。
5. IF 触发 `moderation` 层级, THEN THE ImageService SHALL 不再对该节点重试，并在制品中保留审核拒绝原因。

### Requirement 7: Phase 1 服务端密钥隔离与成本治理

**User Story:** As a 安全负责人, I want 图像生成 API key 仅存在于服务端 ImageApiClient, so that 浏览器侧永远不会泄露密钥。

#### Acceptance Criteria

1. THE ImageApiClient SHALL 在服务端进程内通过 `process.env.IMAGE_GEN_API_KEY` 读取密钥。
2. IF 任何客户端代码尝试通过 `window` / `localStorage` 持有 `IMAGE_GEN_API_KEY`, THEN THE System SHALL 在代码评审阶段被识别为违规，且运行时不会向客户端响应中包含该密钥。
3. WHEN ImageApiClient 完成一次 image API 调用, THE ImageApiClient SHALL 将本次调用的耗时、模型、降级层级与估算成本写入 BlueprintCostTracker。
4. THE ImageService SHALL 通过 `client → whybuddy server → image proxy domain → image model` 的链路完成调用，禁止浏览器直连图像模型域。

### Requirement 8: Phase 1 制品持久化与下载文件命名

**User Story:** As an autopilot 用户, I want 生成的图像与 spec 节点版本绑定并支持本地下载, so that 不同版本的 effect preview 可被审计与归档。

#### Acceptance Criteria

1. THE ImageService SHALL 把每张 base64 图像写入对应节点的 `BlueprintEffectPreview` 制品字段，而非浏览器 localStorage。
2. WHEN 用户在 EffectPreviewImagePanel 中点击下载, THE EffectPreviewImagePanel SHALL 以 `effect-preview-<nodeId>-v<version>-<timestamp>.png` 模式导出文件。
3. THE EffectPreviewImagePanel SHALL 在 gallery 中按节点 ID 分组展示图像。

### Requirement 9: Phase 1 客户端图像面板与等待反馈

**User Story:** As an autopilot 用户, I want 在 10-30 秒的等待中看到清晰的加载反馈, so that 不会误以为系统已经卡死。

#### Acceptance Criteria

1. WHILE 当前 `activeStageKey` 等于 `effect_preview`, THE EffectPreviewImagePanel SHALL 渲染在 autopilot 右侧 rail 中。
2. WHILE 任意节点处于图像生成中, THE EffectPreviewImagePanel SHALL 展示 conic-gradient loading orb 并标注当前节点名称。
3. WHEN 同一节点的图像在最近 24 张缓存范围内, THE ImageGalleryCache SHALL 优先从 IndexedDB 读取 base64 而不重新发起服务端请求。
4. THE ImageGalleryCache SHALL 至多保留 24 条 base64 记录，溢出时按最近最少使用策略淘汰。

### Requirement 10: Phase 1 图像设置面板与配置可见性

**User Story:** As an autopilot 运维者, I want 在客户端确认 `IMAGE_GEN_*` 是否已配置, so that 在调试出图问题时可以快速判断是配置缺失还是上游失败。

#### Acceptance Criteria

1. THE AutopilotImageSettingsPanel SHALL 展示 `IMAGE_GEN_BASE_URL`、`IMAGE_GEN_MODEL`、`IMAGE_GEN_PATH`、`IMAGE_GEN_DEFAULT_SIZE`、`IMAGE_GEN_DEFAULT_ASPECT`、`IMAGE_GEN_TIMEOUT_MS` 的当前生效值。
2. WHEN AutopilotImageSettingsPanel 渲染 API key, THE AutopilotImageSettingsPanel SHALL 仅显示前 8 位与后 6 位字符并以掩码替换中间部分。
3. IF `IMAGE_GEN_API_KEY` 未配置, THEN THE AutopilotImageSettingsPanel SHALL 显示「未配置」状态并禁用手动重试按钮。

### Requirement 11: Phase 2 七层 OKLCH 视觉令牌库

**User Story:** As a 前端开发者, I want 一套覆盖 7 个语义层的 OKLCH 调色板, so that 自动驾驶相关组件不再各自硬编码颜色。

#### Acceptance Criteria

1. THE VisualTokens SHALL 提供 `entry`、`frontend`、`backend-core`、`AI-capability`、`governance`、`business-loop`、`data-state`、`external-integration` 八个语义键的颜色值。
2. THE VisualTokens SHALL 为每个语义键同时提供 light 与 dark 两套 OKLCH 取值。
3. THE VisualTokens SHALL 与项目现有主题系统的 OKLCH 色彩空间保持一致。
4. WHEN 主题在 light 与 dark 之间切换, THE VisualTokens SHALL 在不重新加载页面的情况下输出对应主题取值。

### Requirement 12: Phase 2 横向跨切链路条

**User Story:** As an autopilot 用户, I want 在 spec 视图中水平浏览跨切关注点链路, so that 可以一眼看到「事件总线 → 中继 → 实时 store」这种横向调用关系。

#### Acceptance Criteria

1. THE HorizontalCrossCutBar SHALL 接收一组节点标识并按数组顺序水平展示链路。
2. THE HorizontalCrossCutBar SHALL 从 VisualTokens 读取 `business-loop` 与 `data-state` 取值，禁止硬编码颜色。
3. WHEN 主题切换发生, THE HorizontalCrossCutBar SHALL 同步刷新文本与连接线颜色。

### Requirement 13: Phase 2 代码边界侧栏

**User Story:** As a 开发者, I want 在 design.md 旁边看到对应 spec 节点的真实代码目录路径, so that 设计与实现的边界可以被一眼对照。

#### Acceptance Criteria

1. THE CodeBoundarySidebar SHALL 读取 spec 节点的 `codePaths` 元数据并按目录展示。
2. IF spec 节点未声明 `codePaths`, THEN THE CodeBoundarySidebar SHALL 渲染「未声明代码边界」占位提示。
3. THE CodeBoundarySidebar SHALL 与 design.md 视图保持并排布局，且文字色取自 VisualTokens 的 `frontend` 与 `backend-core` 取值。

### Requirement 14: Phase 3 项目主链 6 步时间线

**User Story:** As a 项目用户, I want 在 ProjectCockpitHome 一眼看到 6 步主链当前进度, so that 可以判断项目卡在哪一阶段。

#### Acceptance Criteria

1. THE ProjectMainChainTimeline SHALL 依次渲染 `Project`、`Clarification`、`Spec`、`Route`、`Execution`、`Evidence` 六个步骤。
2. THE ProjectMainChainTimeline SHALL 对每个步骤提供 `pending` 灰、`running` 蓝色脉冲、`completed` 绿色对勾、`blocked` 黄色 ⚠、`failed` 红色 ✗ 五种视觉状态。
3. WHILE 当前活跃步骤存在, THE ProjectMainChainTimeline SHALL 高亮该步骤并保持非活跃步骤为静态状态。
4. THE ProjectMainChainTimeline SHALL 挂载在 `ProjectCockpitHome` 而非 `AutopilotRoutePage`。

### Requirement 15: Phase 3 Effect Preview 调度时间线

**User Story:** As an autopilot 用户, I want 在 effect_preview 阶段看到节点出图调度顺序, so that 可以预判下一张要出哪张图。

#### Acceptance Criteria

1. WHILE `activeStageKey` 等于 `effect_preview`, THE EffectPreviewScheduleTimeline SHALL 渲染在 Phase 1 右侧 rail 槽位中。
2. THE EffectPreviewScheduleTimeline SHALL 同时消费 `BlueprintEffectPreview.progressPlan[]` 与 `dependencyOrder[]`。
3. WHEN `dependencyOrder[]` 发生变化, THE EffectPreviewScheduleTimeline SHALL 通过 Framer Motion FLIP 动画把节点位置从旧次序过渡到新次序。
4. THE EffectPreviewScheduleTimeline SHALL 从 VisualTokens 读取颜色，禁止硬编码状态色。

### Requirement 16: Phase 3 项目能力角标

**User Story:** As a 项目用户, I want 在 ProjectCockpitHome 顶栏看到稳定的项目能力快照, so that 可以快速建立对项目规模的整体认知。

#### Acceptance Criteria

1. THE CapabilitySnapshotBadges SHALL 在 `ProjectCockpitHome` 顶栏展示 `14 shared contracts`、`77 specs`、`5 capability bridges`、`Mission/Browser/Docker runtimes` 四枚静态角标。
2. THE CapabilitySnapshotBadges SHALL 不依赖运行时计算，文本来自静态配置。
3. THE CapabilitySnapshotBadges SHALL 从 VisualTokens 读取背景与文字色。

### Requirement 17: 跨阶段视觉令牌消费与软依赖

**User Story:** As a 前端架构师, I want Phase 1 与 Phase 3 的可视化组件最终消费 Phase 2 的视觉令牌, so that 项目颜色系统不会出现并行硬编码痕迹。

#### Acceptance Criteria

1. THE EffectPreviewImagePanel、EffectPreviewScheduleTimeline、ProjectMainChainTimeline、CapabilitySnapshotBadges、HorizontalCrossCutBar、CodeBoundarySidebar SHALL 通过 VisualTokens 模块取色，不在组件内部硬编码颜色字面量。
2. WHILE Phase 2 的 VisualTokens 模块尚未上线, THE Phase 1 与 Phase 3 组件 SHALL 临时引用一组占位常量，并保留单一替换点供 Phase 2 上线后切换。
3. WHEN VisualTokens 模块上线, THE 占位常量 SHALL 被替换为 VisualTokens 取值且不引入新的硬编码色。

### Requirement 18: 跨阶段架构与文件命名约束

**User Story:** As a 工程评审者, I want 三个阶段新增的所有文件遵守仓库既有约定, so that 合并时无需对结构做额外协商。

#### Acceptance Criteria

1. THE 服务端图像相关代码 SHALL 位于 `server/routes/blueprint/effect-preview/` 目录，并使用 kebab-case 文件名 `image-api-client.ts` 与 `image-service.ts`。
2. THE 视觉令牌模块 SHALL 位于 `client/src/lib/autopilot/visual-tokens.ts`。
3. THE 客户端组件文件 SHALL 使用 PascalCase 命名（如 `EffectPreviewImagePanel.tsx`、`HorizontalCrossCutBar.tsx`、`CodeBoundarySidebar.tsx`、`ProjectMainChainTimeline.tsx`、`EffectPreviewScheduleTimeline.tsx`、`CapabilitySnapshotBadges.tsx`）。
4. THE System SHALL 允许中文 JSDoc 注释，且组件 props 与 testid 必须使用英文标识符。
5. THE Phase 1 范围 SHALL 不包含 image edit 多部分上传 `/v1/image/edit` 接口，相关能力交由后续 spec 处理。
