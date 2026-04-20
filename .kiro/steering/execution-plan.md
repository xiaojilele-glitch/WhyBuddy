<!--
 * @Author: wangchunji
 * @Date: 2026-04-01 09:20:21
 * @Description:
 * @LastEditTime: 2026-04-15 02:20:00
 * @LastEditors: wangchunji
-->

---

## inclusion: auto

# Specs 执行顺序与依赖分析

## 总览

截至 2026-04-15，`.kiro/specs` 共 66 个目录。前三层主线与补充 spec `holographic-ui` 已基本落地，`workflow-artifacts-display` 已完成功能开发、待最终检查点；任务控制台补完主线与信息架构收口主线已完成，办公室主壳与统一智能发起入口已进入收口阶段，`launch-operator-surface-convergence` 已完成开发与自动化验证、仅剩桌面手测，当前新增规划重点继续转向桌面端首屏体验收束与后墙场景化监控设备推进，平台层能力（L31-L38）仍待环境就绪。

> **维护说明**：本文件保留原始执行顺序与依赖分析，供追溯和继续排期使用；若与旧段落的历史口径冲突，以本节快照为准。

## 已完成归档模块

- [x] P00 `workflow-engine` — 十阶段工作流引擎
- [x] P01 `dynamic-organization` — 动态组织生成
- [x] P02 `memory-system` — 三级记忆系统
- [x] P03 `evolution-heartbeat` — 自进化与心跳
- [x] P04 `mission-runtime` — Mission 任务域（核心部分）
- [x] P05 `feishu-bridge` — 飞书集成
- [x] P06 `browser-runtime` — 纯前端运行时
- [x] P07 `frontend-3d` — 3D 场景与前端

## 当前维护快照（2026-04-15）

- 已合并主线：阶段 0、第一层、第二层和第三层链路均已实现并合并。
- 已完成补充 spec：`ai-enabled-sandbox`、`executor-integration`、`holographic-ui`。
- `workflow-artifacts-display` 已完成功能开发：Artifact API、`tasks-store` 扩展、ArtifactListBlock / ArtifactPreviewDialog、WorkflowPanel / TaskDetailView 集成与 Socket 联动均已落地；当前仅剩 `tasks.md` 中最终检查点未勾选。
- 历史尾项：`mission-runtime`、`multi-modal-vision`、`nl-command-center`、`state-persistence-recovery` 仍有少量未勾选任务，属于补测或收尾项。
- 新增近端主线：`mission-cancel-control`、`mission-operator-actions`、`task-detail-operations-first`、`execution-language-refresh`、`mission-ui-polish` 已完成。
- 新增下一波规划：`navigation-convergence`、`task-hub-convergence`、`api-fallback-empty-states`、`workflow-panel-decomposition`、`scene-agent-interaction`、`workspace-visual-unification` 已完成并合并到 `main`。
- `office-task-cockpit` 已进入收口阶段，桌面端办公室主壳、三栏驾驶舱、右侧上下文 tab 与统一智能发起入口已落地，剩余桌面兼容回归与手测。
- `task-os-home-redesign-v1` 已补一处桌面断点稳定性修正：为 `office-cockpit-splitter` 的 panel 增加 `min-width:0` / `min-height:0`，避免 1280+ 下横向溢出导致布局抖动（2026-04-20）。
- `launch-operator-surface-convergence` 已完成第一阶段实现：`UnifiedLaunchComposer` 接入底部任务操作 rail，`OfficeTaskCockpit.tsx` / `TasksPage.tsx` 已完成接线，`TasksCockpitDetail` 首屏独立任务操作卡已降级为建议与依据区；`tasks.md` 当前仅剩 `7.4` 桌面端与窄宽度手动验证未勾选。
- `office-cockpit-first-screen-refresh` 已进入近端规划，作为 `office-task-cockpit` 的后续桌面首屏体验收口项，聚焦“克制驾驶舱 + 主次分层”。
- `office-wall-display-redesign` 已进入近端规划，作为 `scene-mission-fusion`、`sandbox-live-preview` 与 `office-task-cockpit` 的后续墙面监控屏改造项，聚焦把后墙升级为“终端 / 任务 / 浏览器”三分区显示器。
- 待启动：`i18n-cleanup`、第四层 L31-L38，以及尚未补 `tasks.md` 的 `frontend-demo-mode`。
- 工程健康：`npm run check` 当前存在 30 个 TypeScript 错误，属于需要单独收敛的基线欠账。

## 阶段 0：契约先行（并行前必须完成）

<p align="center">
  <img src="../../docs/execution-plan/stage-0-contract-foundation.svg" alt="阶段 0：契约先行架构图" width="100%" />
</p>

- [x] C01 `demo-data-engine` 数据包 schema 冻结 → `shared/demo/contracts.ts`
- [x] C02 事件总线格式统一 → `shared/telemetry/contracts.ts`
- [x] C03 Memory 读写接口分层 → `shared/memory/contracts.ts`
- [x] C04 workflow-decoupling 目标数据结构冻结 → `shared/mission/enrichment.ts`
- [x] C05 跨框架导出格式契约 → `shared/export/contracts.ts`
- [x] C06 LLM 多提供商抽象层 → `shared/llm/contracts.ts`
- [x] C07 RAG Pipeline 步骤链 → `shared/rag/contracts.ts`
- [x] C08 Skill 注册制 → `shared/skill/contracts.ts`

## 第一层：无依赖，可独立并行，纯前端可执行

<p align="center">
  <img src="../../docs/execution-plan/layer-1-browser-parallel.svg" alt="第一层架构图" width="100%" />
</p>

### 并行组 A：Frontend Mode 极致化（核心优先）

- [x] L01 `demo-data-engine` — 预录演示数据引擎 ✅ 已合并 (13 files, +1317)
- [x] L02 `demo-guided-experience` — 演示回放引擎 + 引导 UI ✅ 已合并 (11 files, +940)

### 并行组 B：3D 场景增强

- [x] L03 `scene-mission-fusion` — Mission 状态融合进 3D 场景 ✅ 已合并 (7 files, +627)
- [x] L04 `cross-framework-export` — 导出为 CrewAI/LangGraph/AutoGen 格式 ✅ 已合并 (18 files, +2866)

### 并行组 C：可观测性（需先完成 C02 事件总线约定）

- [x] L05 `telemetry-dashboard` — 实时遥测仪表盘 ✅ 已合并 (15 files, +1305)
- [x] L06 `cost-observability` — 成本可观测性，Token 追踪 + 前端看板 ✅ 已合并 (14 files, +3181)
- [x] L07 `state-persistence-recovery` — 浏览器端长任务恢复 ✅ 已合并 (30 files, +4639)

### 独立可做

- [x] L08 `collaboration-replay` — Mission 执行过程录制与回放 ✅ 已合并 (52 files, +8291)
- [x] L09 `multi-modal-vision` — 图片理解能力，前端附件扩展 ✅ 已合并 (19 files, +1478)

## 第二层：需要服务端，不需要 Docker

<p align="center">
  <img src="../../docs/execution-plan/layer-2-server-without-docker.svg" alt="第二层架构图" width="100%" />
</p>

### 并行组 D：技术债清理（应优先，⚠️ C04 必须先完成）

- [x] L10 `workflow-decoupling` — tasks-store 从双轨收口到 mission-first ✅ 已合并 (17 files, +1027/-2166)
- [x] L11 `mission-native-projection` — /api/planets 路由实现 + 前端数据源切换 ✅ 已合并 (13 files, +2793)

### 并行组 E：Agent 能力增强

- [x] L12 `plugin-skill-system` — Skill 热插拔体系 ✅ 已合并 (16 files, +1273)
- [x] L13 `dynamic-role-system` — Agent 运行时角色切换 ✅ 已合并 (29 files, +4961)
- [x] L14 `human-in-the-loop` — 通用审批流 + 决策链 ✅ 已合并 (29 files, +2309)

### 并行组 F：记忆系统升级（⚠️ C03 + C07 必须先完成）

- [x] L15 `knowledge-graph` — 结构化知识图谱层 ✅ 已合并 (43 files, +13786)
- [x] L16 `vector-db-rag-pipeline` — 向量数据库 + RAG 管道 ✅ 已合并 (60 files, +8916)

### 独立可做

- [x] L17 `nl-command-center` — 自然语言指挥中心 ✅ 已合并 (65 files, +13234)
- [x] L18 `agent-autonomy-upgrade` — Agent 自评估 + 竞争执行 ✅ 已合并 (28 files, +4691)
- [x] L19 `agent-reputation` — Agent 信誉评分系统 ✅ 已合并 (28 files, +4360)
- [x] L20 `multi-modal-agent` — 语音 + Vision 统一编排 ✅ 已合并 (20 files, +2302)
- [x] L21 `cost-governance-strategy` — 主动成本治理 ✅ 已合并 (10 files, +1850)

## 第三层：Docker 执行链路（严格串行，无法并行）

<p align="center">
  <img src="../../docs/execution-plan/layer-3-docker-execution-chain.svg" alt="第三层 Docker 执行链路架构图" width="100%" />
</p>

```
串行执行顺序（不可跳过）：
L22 → L23 → L24
            → L25
L22 → L22.5（独立并行）
L22 → L24.5（独立并行，桥接 WorkflowEngine ↔ Docker）
```

- [x] L22 `lobster-executor-real` — Docker 真实容器生命周期（大）✅ 已完成 (15 test files, 61 tests, 12 PBT properties)
- [x] L22.5 `ai-enabled-sandbox` — Docker 容器 AI 能力注入（中）✅ 已合并 (20 files, +2261)
- [x] L23 `secure-sandbox` — Docker 安全沙箱（中）✅ 已合并 (24 files, +2283)
- [x] L24 `sandbox-live-preview` — 容器实时终端 + 截图预览（中）✅ 已合并 (25 files, +2177)
- [x] L24.5 `executor-integration` — WorkflowEngine ↔ Docker 执行管线桥接（中）✅ 已合并 (30 files, +5916)
- [x] L25 `agent-permission-model` — Agent 细粒度权限矩阵（中）✅ 已合并 (46 files, +9970)

### 第三层其他串行链路

```
L18 → L26
L14 → L27 → L28
L12 → L29 → L30
```

- [x] L26 `autonomous-swarm` — 跨 Pod 自主协作（大）✅ 已合并 (15 files, +3931)
- [x] L27 `audit-chain` — 不可篡改审计日志（中）✅ 已合并 (37 files, +9125)
- [x] L28 `data-lineage-tracking` — 数据血缘追踪（中）✅ 已合并 (42 files, +9684)
- [x] L29 `a2a-protocol` — 跨框架 Agent 互操作协议（大）✅ 已合并 (22 files, +3068)
- [x] L30 `agent-marketplace` — Guest Agent 机制（中）✅ 已合并 (18 files, +2363)

## L30 后新增主线：任务控制台补完（2026-04-09）

<p align="center">
  <img src="../../docs/execution-plan/post-l30-task-console.svg" alt="L30 后新增主线：任务控制台补完架构图" width="100%" />
</p>

在 Docker 执行闭环与 Artifact 回传跑通后，近期优先级从“能执行”转向“可运营、可协作、可交付”。这条新增主线落在现有 `/tasks` 与任务详情页之上，不改变 L31-L38 的平台级依赖顺序，目标是把任务页从“结果观察面板”推进为“执行控制台”。

### 优先级与依赖

- [x] P0 `mission-cancel-control` — 任务取消端到端可用；补齐用户入口、服务端状态流转、执行器取消、Socket 回传与 UI 反馈闭环。
- [x] P0 `mission-operator-actions` — 统一操作动作栏，至少支持暂停 / 恢复 / 重试 / 标记阻塞 / 终止；依赖取消与终止语义先收口。
- [x] P1 `task-detail-operations-first` — 重排任务详情页第一屏，把主操作、当前负责人、blocker、下一步动作前置；依赖稳定的操作动作模型。
- [x] P1 `execution-language-refresh` — 将“动态组队 / 方案叙事”收敛为“开发执行 / 协作交付 / 当前行动”，可与详情页重排并行推进。
- [x] P2 `mission-ui-polish` — 打磨反馈时机、按钮层级、状态可见性、空态与错误态；依赖前述交互语义基本稳定后收尾。

### 交付顺序建议

1. 先打通取消与状态操作，保证任务生命周期可控。
2. 再重排详情页与核心文案，让用户第一屏就能判断“谁在负责、卡在哪里、下一步做什么”。
3. 最后统一 UI 反馈与状态表达，避免在交互语义未稳定前重复返工。

> 目标：把任务页从“执行结果展示”提升为“可操作的执行控制台”。

## L30 后新增主线二：信息架构收口与工作台重构（2026-04-11）

<p align="center">
  <img src="../../docs/execution-plan/post-l30-workspace-restructure.svg" alt="L30 后新增主线二：信息架构收口与工作台重构架构图" width="100%" />
</p>

在任务控制台补完主线完成后，当前核心问题不再是“能不能控制任务”，而是“用户打开系统后是否知道先看哪里、下一步做什么”。这一波新增主线聚焦信息架构收口、主操作中心统一、场景交互补位与体验兜底，不改变 L31-L38 的平台级依赖顺序，目标是把系统从“多工具并列”推进到“单主线工作台”。

### 优先级与依赖

- [x] P0 `navigation-convergence` — 将一级导航收口为“办公室 / 任务 / 更多”；建立主路径骨架，弱化 8 个并列入口。
- [x] P0 `task-hub-convergence` — 将命令输入、任务列表、执行进度与人工干预收口到 `/tasks`；与导航收口强协同，是新的唯一主操作中心。
- [x] P0 `api-fallback-empty-states` — 统一 fetch 兜底、演示模式提示、空态与错误态；可与前两项并行，但建议先做低冲突 store 与低频页面。
- [x] P1 `workflow-panel-decomposition` — 拆解 `WorkflowPanel`，让任务信息回归任务页、Agent 信息回归办公室；已完成并合并到 `main`。
- [x] P1 `scene-agent-interaction` — 让 3D 场景承接 Agent 详情侧栏、公告板与阶段流线；已完成并合并到 `main`。
- [x] P2 `workspace-visual-unification` — 统一暖色工作台视觉语言，优先治理 `LineagePage` 与“更多”下低频页面；已完成并合并到 `main`。

### Worktree 并行建议

#### Wave 1：已完成

- `navigation-convergence`
- `task-hub-convergence`
- `api-fallback-empty-states`（仅第一批：公共请求层 + 低冲突 store + 低频页面空态）

#### Wave 2：已完成

- `workflow-panel-decomposition`
- `scene-agent-interaction`
- `workspace-visual-unification`

### 文件 ownership 边界

- `navigation-convergence` 独占：`client/src/App.tsx`、`client/src/pages/Home.tsx`、`client/src/components/Toolbar.tsx`
- `task-hub-convergence` 独占：`client/src/pages/tasks/TasksPage.tsx`、`client/src/components/tasks/TaskDetailView.tsx`、`client/src/pages/nl-command/*`、`client/src/components/nl-command/*`
- `workflow-panel-decomposition` 独占：`client/src/components/WorkflowPanel.tsx`、`client/src/lib/workflow-store.ts`
- `scene-agent-interaction` 独占：`client/src/components/Scene3D.tsx`、`client/src/components/three/*`
- `workspace-visual-unification` 优先独占：`client/src/pages/lineage/LineagePage.tsx` 与共享主题层
- `api-fallback-empty-states` 第一阶段避免同时改任务页高频文件，第二阶段再与主链 worktree 协调接入

### 交付顺序建议

1. 先把导航和任务中台收口，解决“先看哪里、先做什么”的根问题。
2. 同步补上 API 兜底、演示模式提示和空态/错误态，避免信息架构优化被技术报错抵消。
3. 再拆 `WorkflowPanel`、增强 3D 办公室交互，让首页和任务页各自承担清晰职责。
4. 最后统一视觉语言，降低割裂感，收尾低频工具页。

> 目标：把系统从“多个工具入口并列”收口为“办公室看态势、任务做推进、更多收低频”的单主线工作台。

## L30 后新增主线三：办公室任务驾驶舱（2026-04-13）

在信息架构与工作台重构主线完成后，当前核心问题进一步从“入口有没有收口”升级为“办公室与任务是否仍然分屏分心智”。这条新增主线聚焦把办公室从态势页推进为默认运行时工作台：桌面端在同一屏中收口任务队列、办公室场景、任务详情与 workflow 上下文，同时保留 `/tasks` 作为全屏工作台与深链页。

### 优先级与依赖

- [ ] P0 `office-task-cockpit` — 开发中：办公室成为桌面端默认执行壳，内嵌任务驾驶舱、统一发起入口与右侧上下文 tab。
- 依赖已完成的 `navigation-convergence`、`task-hub-convergence`、`workflow-panel-decomposition`、`scene-agent-interaction`、`workspace-visual-unification`。
- 当前进展：桌面端办公室壳层、左侧任务队列、中间 `Scene3D`、右侧任务/上下文 tab 与统一智能发起入口已接入；`launch-operator-surface-convergence` 第一阶段已完成，底部共享操作区已支持任务操作并入；剩余兼容回归、桌面 / 窄宽手测与最终验收。

### 文件 ownership 边界

- 主 owner 覆盖 `client/src/pages/Home.tsx`、`client/src/components/tasks/*`、`client/src/components/office/*`，避免与其他高频界面文件并行冲突。

### 交付顺序建议

1. 先搭桌面端办公室壳层与三栏驾驶舱布局。
2. 再把右侧默认 `任务` tab 与 `团队流 / Agent / 记忆报告 / 历史` 上下文 tab 收口。
3. 再实现统一发起入口与“普通任务 + 高级发起”双通道。
4. 最后完成兼容入口、回归验证与桌面手测。

## L30 后新增主线四：办公室首屏风格重构（2026-04-13）

在办公室任务驾驶舱把桌面主壳、三栏结构与统一发起入口收口后，当前核心问题进一步从“能力有没有放进办公室”升级为“首屏是否足够清晰、稳定且适合持续执行”。这条新增主线不是新增业务域，而是对已落地办公室驾驶舱做桌面首屏视觉与信息架构优化：在不削减任务、workflow、Agent、记忆、历史与主操作能力的前提下，把首屏从多块同级卡片并列收敛为单主轴驾驶舱。

### 优先级与依赖

- [ ] P1 `office-cockpit-first-screen-refresh` — 规划中：办公室驾驶舱首屏风格重构，收敛壳层噪音、Scene HUD、统一驾驶台与右侧渐进详情。
- 依赖已在开发中的 `office-task-cockpit`，以及已完成的 `navigation-convergence`、`task-hub-convergence`、`workflow-panel-decomposition`、`scene-agent-interaction`、`workspace-visual-unification`、`mission-ui-polish`、`task-detail-operations-first`。
- 文件 ownership：主 owner 覆盖 `Home.tsx`、`components/office/*`、`components/tasks/*` 与 `index.css`，避免与其他高频 UI 文件并行冲突。
- 交付顺序：先收敛桌面顶层壳层与 cockpit 头部，再重构中栏 Scene HUD 与统一驾驶台，再重排右栏任务优先详情，最后做栏宽回归与桌面手测。

## L30 后新增主线五：办公室墙面显示器重构（2026-04-14）

在办公室首屏风格重构把桌面端壳层噪音、主次关系和右侧渐进详情收口后，当前核心问题进一步从“首屏清不清晰”升级为“后墙中央的信息展示是否真正成为场景的一部分”。这条新增主线聚焦把后墙从嵌入式预览板升级为统一的场景化监控屏：左侧终端执行流、中间任务主控、右侧浏览器实时画面，形成与办公室空间一致的三分区显示器。

### 优先级与依赖

- [ ] P1 `office-wall-display-redesign` — 规划中：重构后墙显示器，统一终端 / 任务 / 浏览器三分区，并将任务 HUD 场景化为真实设备。
- 依赖已完成的 `scene-mission-fusion`、`sandbox-live-preview`，以及已在推进中的 `office-task-cockpit`、`office-cockpit-first-screen-refresh`。
- 文件 ownership：主 owner 优先覆盖 `Scene3D.tsx`、`components/three/SandboxMonitor.tsx`、`components/sandbox/*`、墙面任务摘要组件与 `sandbox-store.ts`，避免场景层与 pane 级聚焦逻辑并行冲突。
- 交付顺序：先重做后墙外壳与三区布局，再实现中间任务主控区，再收终端和浏览器两侧 pane，最后补 pane 级聚焦交互、线缆/光影与桌面回归。

## 第四层：平台级能力（环境就绪后再做，不设时间承诺）

<p align="center">
  <img src="../../docs/execution-plan/layer-4-platform-capabilities.svg" alt="第四层平台级能力架构图" width="100%" />
</p>

- [ ] L31 `production-deployment` — Docker Compose 生产部署（中）← 依赖 L22
- [ ] L32 `multi-user-office` — 多人实时协作（大）
- [ ] L33 `multi-tenant-architecture` — 多租户隔离（大）← 依赖 L25 + L31
- [ ] L34 `agent-marketplace-platform` — Agent 交易市场（大）← 依赖 L30 + L19
- [ ] L35 `k8s-agent-operator` — K8s Agent Operator（大）← 依赖 L31
- [ ] L36 `edge-brain-deployment` — 边缘部署（大）← 依赖 L31
- [ ] L37 `multi-region-disaster-recovery` — 多区域灾备（大）← 依赖 L31 + L35
- [ ] L38 `vr-extension` — VR 沉浸式扩展（大）← 依赖 L03

## Worktree 命名参考

```bash
# 阶段 0 不需要 worktree，在 main 上执行

# 第一层并行
git worktree add ../cpo-L01-demo-data feat/L01-demo-data-engine
git worktree add ../cpo-L02-demo-guide feat/L02-demo-guided-experience
git worktree add ../cpo-L03-scene-fusion feat/L03-scene-mission-fusion
git worktree add ../cpo-L04-export feat/L04-cross-framework-export
git worktree add ../cpo-L05-telemetry feat/L05-telemetry-dashboard
git worktree add ../cpo-L06-cost feat/L06-cost-observability
git worktree add ../cpo-L07-recovery feat/L07-state-persistence-recovery
git worktree add ../cpo-L08-replay feat/L08-collaboration-replay
git worktree add ../cpo-L09-vision feat/L09-multi-modal-vision

# 第二层并行
git worktree add ../cpo-L10-decoupling feat/L10-workflow-decoupling
git worktree add ../cpo-L11-planets feat/L11-mission-native-projection
git worktree add ../cpo-L12-skill feat/L12-plugin-skill-system
git worktree add ../cpo-L13-role feat/L13-dynamic-role-system
git worktree add ../cpo-L14-hitl feat/L14-human-in-the-loop
git worktree add ../cpo-L15-graph feat/L15-knowledge-graph
git worktree add ../cpo-L16-rag feat/L16-vector-db-rag-pipeline

# 第三层串行
git worktree add ../cpo-L22-executor feat/L22-lobster-executor-real

# L30 后体验重构 Wave 1
git worktree add ../cpo-nav feat/navigation-convergence
git worktree add ../cpo-task-hub feat/task-hub-convergence
git worktree add ../cpo-api-fallback feat/api-fallback-empty-states

# L30 后体验重构 Wave 2
git worktree add ../cpo-workflow-panel feat/workflow-panel-decomposition
git worktree add ../cpo-scene-agent feat/scene-agent-interaction
git worktree add ../cpo-visual-unify feat/workspace-visual-unification
```

## 推荐执行时间线

### Day 1 上午：阶段 0 契约冻结（已完成 ✅）

```
C01-C08 全部完成，shared/ 下 8 个契约模块已冻结
```

### Day 1 下午：第一层 + 第二层前半段并行（15 个 Agent）

```
并行组 A: L01 + L02
并行组 B: L03 + L04
并行组 C: L05 + L06 + L07
并行组 D: L10 + L11
并行组 E: L12 + L13 + L14
独立: L08 + L09
```

### Day 2：第二层后半段 + 第三层 Docker 链路串行

```
并行组 F: L15 + L16
串行: L22 ✅ → L23 → L24
剩余 Agent: 集成测试 + 修接口不一致的缝隙
```

### Day 3+：按需推进（当前阶段）

```
第三层全部完成: L26 ✅ → L27 ✅ → L28 ✅
                L29 ✅ → L30 ✅
holographic-ui spec 已完成（tasks 1-8）
第四层 (L31-L38) 待环境就绪
```

### Day 4+：补完型 spec 与工程收口（当前实际）

```
workflow-artifacts-display 已完成功能开发：
  已完成 Artifact API / tasks-store 扩展 / ArtifactListBlock / ArtifactPreviewDialog
  已完成 WorkflowPanel / TaskDetailView 集成与 Socket 联动
  当前仅剩 tasks.md 中“最终检查点”未勾选，待补跑相关测试并完成验收

任务控制台补完主线已完成：
  P0: mission-cancel-control / mission-operator-actions
  P1: task-detail-operations-first / execution-language-refresh
  P2: mission-ui-polish

i18n-cleanup 未启动
frontend-demo-mode 待补 tasks.md
```

### Day 5+：信息架构与工作台重构（新增规划）

```
Wave 1（可直接并行）:
  navigation-convergence
  task-hub-convergence
  api-fallback-empty-states（第一批低冲突接入）

Wave 2（已完成并合并）:
  workflow-panel-decomposition
  scene-agent-interaction
  workspace-visual-unification

并行原则:
  Home/App/Toolbar、TasksPage/TaskDetailView、WorkflowPanel/workflow-store、Scene3D/three/*
  各自由单独 worktree owner 负责，避免跨波次同时改同一批核心文件
```

### Day 6+：办公室任务驾驶舱（已启动，待回归）

```
office-task-cockpit:
  已完成桌面端办公室主壳与三栏驾驶舱装配
  已接入右侧任务 / 团队流 / Agent / 记忆报告 / 历史 tab
  已落地统一智能发起入口
  已完成 launch-operator-surface-convergence 第一阶段：
    UnifiedLaunchComposer 已接入底部任务操作 rail
    OfficeTaskCockpit / TasksPage 已接线
    TasksCockpitDetail 首屏任务操作卡已降级为建议区
    自动化测试已完成，当前仅剩桌面 / 窄宽手测
  剩余兼容回归与桌面手测

执行顺序:
  已完成桌面壳层
  已完成右侧 tab、统一发起基础装配与任务操作底部收敛
  下一步补桌面兼容回归
  最后完成桌面 / 窄宽手测与验收
```

### Day 7+：办公室首屏风格重构（近端规划）

```
office-cockpit-first-screen-refresh:
  目标是在不削减功能的前提下，把办公室首屏收敛为“单主轴 + 克制驾驶舱 + 主次分层”
  保留 Scene3D 主视觉、统一驾驶台、右侧任务优先详情与现有上下文 tab
  不改后端协议、不改 socket、不改 /tasks 深链、不改移动端主路径

执行顺序:
  先收敛顶层壳层与 cockpit 头部
  再重构中栏 HUD 与双通道统一驾驶台
  再重排右栏渐进详情与左侧队列密度
  最后补 1280 / 1440 / 1728+ 桌面回归与手测
```

### Day 8+：办公室墙面显示器重构（近端规划）

```
office-wall-display-redesign:
  目标是在不改变 mission / sandbox 数据主线的前提下，把后墙升级为统一的三分区监控屏
  左侧承接终端执行流，中间承接 Mission Control，右侧承接 Browser Live
  继续由 Scene3D 持有后墙位置与装配权，不引入新的后端契约或第二套任务状态源
执行顺序:
  先重做后墙显示器壳体与三区框架
  再实现中间任务主控区与默认镜头可读性
  再收终端 / 浏览器两侧 pane 的 wall 变体
  最后补 pane 级焦点交互、环境装饰和桌面回归
```

## 关键路径

```
C01-C08 契约冻结 (已完成)
  │
  ├──→ L01 ──→ L02 ──→ Frontend Mode 极致化 ✅
  │
  ├──→ L10 ──→ L11 ──→ 技术债清零 ✅
  │
  ├──→ L22 ✅ ──→ L23 ✅ ──→ Docker 执行闭环 ✅
  │             │
  │             ├──→ L24 ✅
  │             ├──→ L25 ✅
  │             ├──→ L22.5 ✅
  │             └──→ L24.5 ✅
  │
  ├──→ L18 ✅ ──→ L26 ✅ (autonomous-swarm)
  │
  ├──→ L14 ✅ ──→ L27 ✅ ──→ L28 ✅ (data-lineage-tracking)
  │
  └──→ L12 ✅ ──→ L29 ✅ ──→ L30 ✅ (agent-marketplace)
               │
               └──→ 任务控制台补完主线 ✅
                        │
                        └──→ 信息架构与工作台重构
                              ├──→ Wave 1: navigation-convergence + task-hub-convergence + api-fallback-empty-states
                              └──→ Wave 2: workflow-panel-decomposition + scene-agent-interaction + workspace-visual-unification
```

## 风险提示

1. Docker 链路（L22-L25）：L22 咽喉节点已完成，L23/L24/L25 已解锁，仍需真实环境调试
2. 第四层（L31-L38）没有真实多节点环境验证无意义，不建议急着做
3. 并行组内如果跳过阶段 0 的契约冻结，会导致接口不一致需要返工
4. L20 和 L21 虽然在第二层，但分别依赖第一层的 L09 和 L06，不能真正并行
5. 新一波体验重构如果不按 ownership 拆 worktree，`Home.tsx`、`TasksPage.tsx`、`TaskDetailView.tsx`、`WorkflowPanel.tsx` 会成为高冲突热点
6. `api-fallback-empty-states` 可以先并行，但不要一开始就同时改任务页高频请求与 `workflow-store`，否则会与任务中台和面板拆解互相阻塞
7. 当前 TypeScript 基线未清零，新增 spec 若不控制编译回归，容易把补完型工作拖成全局修复

## 2026-04-15 增补：当前运行时兼容层

- `dev:all` 默认优先 `real`，Docker 不可用时回退到 `native`
- executor 现已支持 `mock | native | real`
- GitHub Pages 只走前端浏览器运行时
- 详细补充说明见 `.kiro/steering/2026-04-15-runtime-current-state.md`

## 2026-04-16 新增主线收敛 specs（2026-04-20 已回填状态）

### 新增 specs 清单

- [ ] `office-shell-convergence-v1`
  - 当前状态：进行中，约 97%；主路由、主导航和 `/tasks` 语义已基本收敛
  - 已落地：`/debug` 壳路由、`/command-center` -> `/`、`Toolbar` 主导航收敛为 `office / more`、`MoreDrawer` 低频治理入口统一导向 `/debug/*`、`/lineage` -> `/debug/lineage`、`/command-center/legacy` 纯兼容跳转，以及低频路由的 path segment 级匹配保护
  - 剩余：`/debug/*` 子路径人工回归；定向自动校验已覆盖 `/debug/help`、`/debug/lineage`、兼容跳转、query 场景与低频路由误判边界，剩余主要是人工确认真实页面加载与点击流
  - 主线起点，负责首页默认入口、导航心智与路由壳收敛
  - 锁定 `/tasks` 为“查看 / 跟进 / 深度处理”的全屏工作台，不再承担发起语义
  - 只定义 `/debug` 的隐藏路由壳与入口策略，不要求同轮完成所有低频能力迁移
  - 不与后两项主线 spec 并行
- [ ] `task-os-home-redesign-v1`
  - 当前状态：进行中，约 85%；首页四区骨架与右侧主交互归位已落地，主要剩断点与人工验收收尾
  - 已落地：顶部状态条、左侧任务队列、中间场景与任务主线、右侧任务上下文、底部运行区，以及右侧 `launch` tab 承接统一发起 / 澄清
  - 剩余：首屏主次稳定性验收、`1280 / 1440 / 1728+` 与移动端最终手测未完成
  - 依赖 `office-shell-convergence-v1`
  - 在现有视觉基底上做首页四区骨架重构，不重做设计系统
  - 重点收敛首页壳体、信息层级、模块归位与桌面断点稳定性
  - 不并行
- [ ] `task-runtime-visibility-v1`
  - 当前状态：进行中，约 98%；主线收口已基本完成，剩余主要是边界声明与人工验收
  - 已落地：`MissionStepFlow`、`Logs / Artifacts / Runtime` 归口、详情页与 cockpit 的运行证据 defer、workflow / review handoff 直连首页 `Artifacts`、`socket / callback` 可读摘要与连接态即时同步，以及共享 `office-runtime-evidence` 事件 helper / 回归测试
  - 剩余：`socket / callback` 仍保持前端轻量派生而不扩成第二套真相源；若继续整理墙面浏览器回传与截图放大路径一致性，应转入 `office-wall-display-redesign-v2`
  - 依赖 `task-os-home-redesign-v1`
  - 基于现有 mission / workflow / task detail / socket 数据，把步骤流、Logs、Artifacts、Runtime 收敛到首页
  - 优先做运行证据归口，不再造第二套真相源
  - 不并行
- [ ] `release-stability-guardrails-v2`
  - 当前状态：进行中，约 90%；统一 `lint / typecheck / test / build` 入口、最小 CI、README 回填与轻量关键链路入口已落地，最小任务焦点 re-attach、失效焦点回退与 sandbox 回挂链路已补齐，完整工作上下文 re-attach 仍未收尾
  - 已落地：`lint`、`typecheck`、`test`、`build`、`test:decision`、`test:guardrails`、`test:release`、Pages workflow、release guardrails workflow、mission socket 重连后主动刷新任务数据、当前任务焦点持久化回挂、内存焦点失效时回退到持久化任务焦点、已加载详情的 socket 运行态即时回写、SandboxMonitor 跟随恢复后的任务焦点回挂 active mission 并重拉日志历史、restart smoke
  - 剩余：任务完整工作上下文 re-attach 的实现与 spec 级验收闭环
  - 可与主线并行
  - 以补齐统一聚合入口、最小 CI、关键链路测试和恢复能力为主
  - 优先建立 `lint` / `typecheck` / `test` / `build` 聚合入口，不要求一次性重写全部历史脚本
- [ ] `replay-and-debug-surface-v1`
  - 当前状态：进行中，约 88%；回放主链稳定，debug 壳已存在，主壳治理入口已基本接线
  - 已落地：`/replay/:missionId`、任务详情页“查看回放”入口、`/debug` 页面与低频路径识别、`config / permissions / audit / lineage / help` 导向 `/debug`，以及低频路径 path segment 级误判保护
  - 剩余：`/debug/*` 子路径和旧深链跳转的人工回归；定向自动校验已覆盖 `/debug/help`、`/debug/lineage`、旧深链跳转、query 场景与低频路径误判边界，剩余主要是人工确认真实 replay 数据承接
  - 与主线“部分并行”，不再视为完全独立并行项
  - 可先并行：回放稳定性、低频能力盘点、debug 信息架构设计
  - 后置接线：`/debug` 最终接线、主导航低频入口移除，等待主壳路由与导航定稿后再落

### 当前完成度摘要（管理视角）

- 主线收敛三件套已经形成明确梯度：
  - `office-shell-convergence-v1` 负责入口、导航与壳体语义，当前约 `97%`
  - `task-os-home-redesign-v1` 负责首页四区骨架与桌面主次，当前约 `75%`
  - `task-runtime-visibility-v1` 负责步骤流与运行证据归口，当前约 `98%`
- 就“离收尾最近”而言，优先级应是：
  - 先完成 `task-runtime-visibility-v1` 的剩余边界确认与人工验收
  - 再收 `office-shell-convergence-v1` 的 `/debug/*` 回归边界
  - 再做 `task-os-home-redesign-v1` 的右侧控制区归位和桌面断点 / 手测闭环
- `release-stability-guardrails-v2` 当前约 `90%`，已具备最小门禁、README/CI/脚本对齐、轻量关键链路 spot-check、最小任务焦点 re-attach、失效焦点回退与 sandbox 回挂链路，但仍不应误判为“已具备完整工作上下文 re-attach 闭环”
- `replay-and-debug-surface-v1` 当前约 `88%`，建议继续保持“信息架构先行、最终接线后置”的节奏，不要早于主壳定稿强行完成全部 debug 迁移

### 剩余动作清单（建议顺序）

1. 收尾 `task-runtime-visibility-v1`
   - 保持 `socket / callback` 与 shared runtime evidence 事件都为派生摘要 / 导航语义层，不再扩成第二套 runtime 真相源
   - 将墙面浏览器回传 / 截图放大链路的后续收尾明确转交 `office-wall-display-redesign-v2`
2. 收尾 `office-shell-convergence-v1`
   - 补一轮 `/debug/*` 子路径与旧深链跳转的人工回归
3. 收尾 `task-os-home-redesign-v1`
   - 完成 `1280 / 1440 / 1728+` 桌面宽度与移动端最小回归手测
4. 并行推进 `release-stability-guardrails-v2`

- 维持 `lint / typecheck / test / build` 与 `test:guardrails` 口径同步
- 保持“当前任务焦点 / 失效焦点回退 / sandbox 回挂”这组最小恢复链路继续有回归保护
- 补任务完整工作上下文 re-attach 的实现与 spec 级验收闭环

5. 后置接线 `replay-and-debug-surface-v1`
   - 同步移除主界面残留的低频高可见入口

### 本周可执行 Checklist（2026-04-20 起）

本周目标不是再开新主线，而是把这 5 个 spec 中最接近收尾、最影响主线体验的缺口真正收口，并把并行项压到“可验收、可交接”的状态。

#### 串行主线

1. 先收 `task-runtime-visibility-v1`
   - [x] 清掉首页主视图里残留的重复日志主入口
   - [x] 清掉首页主视图里残留的重复 artifact 主入口
   - [x] 清掉独立任务详情页里仍与首页运行证据容器平级竞争的日志 / artifact 主入口
   - [x] 补一轮定向回归，确保 `Logs / Artifacts / Runtime` 继续维持唯一主出口语义
   - [x] 细化 `socket / callback` 的 relay / callback 可读摘要与连接态同步
   - 完成判断：首页与详情页不再出现两套平级运行证据主入口；相关回归测试通过；墙面浏览器回传后续问题不再混入本 spec

2. 再收 `office-shell-convergence-v1`
   - [x] 定稿 `/command-center/legacy` 的最终策略
   - [x] 若保留兼容页，明确它只承担说明 / 引导，不再承载旧版主工作台能力
   - [x] 继续把 `permissions / audit / config` 从 `MoreDrawer` 向 `/debug` 收口
   - [x] 定稿 `/lineage` 是否继续保留独立深链页
   - [x] 将 `help` 从主壳 modal 收口到 `/debug/help`
   - [ ] 补一轮人工路由与导航回归，确保 `/`、`/tasks`、`/debug`、`/replay/:missionId` 的角色边界稳定
   - 完成判断：`/command-center` 与 `/command-center/legacy` 的退场策略稳定，主导航不再给低频入口过高权重

3. 再收 `task-os-home-redesign-v1`
   - [ ] 做 `1280 / 1440 / 1728+` 桌面宽度手测
   - [ ] 做一轮移动端最小回归，确认本轮改造未直接破坏主路径
   - [ ] 按 `manual-verification.md` 补一轮首页主次与模块归位验收
   - 完成判断：首页四区主次稳定，用户不用跳页即可走完主流程，断点未出现明显结构崩坏

#### 并行护栏

4. 并行推进 `release-stability-guardrails-v2`
   - [x] 新增统一 `lint` 聚合入口
   - [x] 新增统一 `typecheck` 聚合入口
   - [x] 新增统一 `test` 聚合入口
   - [x] 对齐 `build`、`check`、分拆测试脚本与外部统一口径
   - [x] 建立最小 CI：install -> lint -> typecheck -> test:guardrails -> test -> build
   - [x] 补 decision approve / reject / modify 的关键链路回归
   - [x] 明确 websocket 恢复与任务 re-attach 的 spec 级验收口径
   - [x] 补当前任务焦点持久化回挂与已加载详情 socket 状态即时同步
   - [x] 补当前内存焦点失效时回退到持久化任务焦点
   - [x] 补 SandboxMonitor 跟随恢复后的任务焦点回挂 active mission 并重拉日志历史
   - 当前判断：统一门禁命令、CI / README / scripts 口径、轻量关键链路入口、最小任务焦点 re-attach、失效焦点回退与 sandbox 回挂链路已对齐；完整工作上下文 re-attach 仍待实现闭环

#### 后置接线

5. 后置推进 `replay-and-debug-surface-v1`
   - [ ] 先完成低频能力盘点，确认 lineage / audit / permission / config 的最终归口
   - [ ] 先只做 `/debug` 的信息架构与内容编排，不提前强改主壳导航
   - [x] `help` 已并入 `/debug/help`
   - [ ] 接线后同步移除主界面残留的低频高可见入口
   - 完成判断：普通用户默认只感知首页与回放，低频能力进入 `/debug` 后不再反向污染主导航

#### 每轮结束前都要检查

- [ ] `tasks.md`、`requirements.md`、`manual-verification.md` 与总表状态同步更新
- [ ] 不把未手测的断点稳定性写成已完成
- [ ] 不把仍在 `MoreDrawer` 或兼容页中的低频能力写成“已完全迁入 `/debug`”
- [ ] 不把当前不存在的 `lint / typecheck / test` 聚合脚本写成已经存在
- [ ] 不新增第二套 mission / workflow / runtime 真相源

#### 本周不要做

- 不要在 `office-shell-convergence-v1` 未定稿前，提前做 `replay-and-debug-surface-v1` 的最终导航接线
- 不要为了首页重构重做设计系统或主题体系
- 不要为了运行证据收口重新造一套独立 runtime 数据模型
- 不要把 `release-stability-guardrails-v2` 的目标态门禁命令直接写进 README 或手工验证，而不先补齐脚本
