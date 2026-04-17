<p align="center">
  <a href="./README.md"><strong>简体中文</strong></a> ·
  <a href="./README.en.md">English</a>
</p>

<p align="center">
  <img src="./banner.png" alt="Cube Pets Office" width="100%" />
</p>

<h1 align="center">Cube Pets Office</h1>

<p align="center">
  <strong>输入一句话，看 AI 团队在 3D 办公室里自己开工</strong><br />
  <sub>Type one sentence. Watch an AI team self-organize in a 3D office.</sub>
</p>

<p align="center">
  <a href="https://opencroc.github.io/cube-pets-office/"><strong>在线体验（无需 API Key）</strong></a> ·
  <a href="#-快速开始">快速开始</a> ·
  <a href="#-一次完整的执行流程">工作流</a> ·
  <a href="#-系统架构">架构</a>
</p>

<p align="center">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-111827" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-238K%20LOC-3178c6" />
  <img alt="specs" src="https://img.shields.io/badge/specs-76-0ea5e9" />
  <img alt="tests" src="https://img.shields.io/badge/tests-379%2B-22c55e" />
  <img alt="3D" src="https://img.shields.io/badge/3D-Three.js-8b5cf6" />
  <img alt="agents" src="https://img.shields.io/badge/agents-%E5%8A%A8%E6%80%81%E7%BB%84%E7%BB%87-f97316" />
  <img alt="i18n" src="https://img.shields.io/badge/i18n-%E4%B8%AD%E6%96%87%20%2F%20English-22c55e" />
  <img alt="PRs" src="https://img.shields.io/badge/PRs-welcome-ec4899" />
</p>

<p align="center">
  <i>如果这个项目让你眼前一亮，给个 Star 是对我们最大的鼓励</i>
</p>

---

## 一句话介绍

> **不是又一个 Agent 框架，而是一个能让你“看见”AI 如何协作的 3D 办公室。**

输入 `制定本季度用户增长策略`，系统自动组建 AI 团队：CEO 拆解方向、经理分配任务、Worker 并行执行、互相评审打分、审计修订、最终汇总进化。整个过程在 3D 办公场景中实时呈现。

它不只是生成文档。系统会把任务规划成结构化执行计划，下发到 Docker 容器中真实运行，页面上展示的是执行状态、运行日志、工件链接和最终结果，而不是一份 Markdown 报告。

- 无需 API Key 即可体验完整可视化与交互流程
- 接入 LLM + 执行器后可跑通真实任务闭环

## 项目概述

Cube Pets Office 是一个从 0 实现的开源多智能体可视化平台。

近期已把 `/tasks` 从“观察执行”推进为“执行控制台”：任务取消、状态操作、blocker、负责人、下一步动作与界面反馈闭环均已落地，任务页已具备更完整的执行协作能力。

同时，桌面端 `/` 正在把办公室升级为默认执行壳：左侧任务队列、中间 `Scene3D`、右侧任务/上下文 tab、统一智能发起入口与底部共享操作区已收口到同一屏，`/tasks` 继续保留为全屏工作台与深链页。最近还完成了“发起 / 任务操作”收敛第一阶段，`UnifiedLaunchComposer` 已直接承载任务操作 rail，首屏控制区进一步收口。

## 八大核心优势

### 动态组织生成

**不是固定角色，而是根据任务内容动态生成 CEO / 经理 / Worker 团队结构。**
编程任务和营销策略会得到完全不同的组织配置。

### 自进化智能体

**每轮工作流结束后，智能体分析自己的弱项维度，自动修补人设定义。**
三级记忆（短期 / 中期 / 长期）让智能体越用越聪明。

### 20 分评审制

**每份交付物按准确性、完整性、可操作性、格式四个维度打分。**
低于 16 分自动退回修订，独立审计员进行元审计，确保质量与合规。

### 真实执行闭环

**不止于 AI 规划，结构化执行计划会下发到 Docker 容器中真实运行。**
页面实时展示容器状态、日志和产物。

### 双运行时架构

**同一套工作流引擎可以跑在浏览器里（IndexedDB + Web Worker）或服务端（Express + JSON）。**
不绑定任何一端。

### 全链路成本治理

**从被动监控到主动治理。**
多级预算、四级告警、灰度模型降级、并发限流、任务暂停审批、成本预测与优化建议，形成完整闭环。

### 跨框架互操作

**通过 A2A 协议与 CrewAI / LangGraph / AutoGen 等外部框架的 Agent 直接通信。**
Guest Agent 机制让外部智能体以沙箱模式临时加入团队。

### 不可篡改审计 + 数据血缘

**哈希链式审计日志确保操作不可篡改。**
数据血缘追踪让每一份数据的来源和流转路径清晰可查。

## 一次完整的执行流程

告别传统的数据看板，在 Cube Pets Office，一切由一个简单的问题开始：

```text
你输入：“制定本季度用户增长策略”
```

| 步骤 | 阶段        | 主要操作                                     | 参与组件             |
| :--: | ----------- | -------------------------------------------- | -------------------- |
|  1   | 动态组建    | 根据任务内容生成 CEO、经理、Worker 团队结构  | 动态组织生成器 + LLM |
|  2   | CEO 拆解    | CEO 将指令分解为各部门方向                   | 工作流引擎 + LLM     |
|  3   | 经理规划    | 每位经理为下属 Worker 分配具体任务           | 工作流引擎 + LLM     |
|  4   | Worker 执行 | Worker 并行产出交付物                        | 工作流引擎 + LLM     |
|  5   | 经理评审    | 经理按 4 维度打分（满分 20），低于 16 分退回 | 评审系统             |
|  6   | 元审计      | 独立审计员检查质量与合规性                   | 审计引擎             |
|  7   | 修订        | 被退回的 Worker 根据反馈修改                 | 工作流引擎 + LLM     |
|  8   | 验证        | 经理逐条确认反馈是否被回应                   | 评审系统             |
|  9   | 汇总        | 部门报告汇总为 CEO 级综合报告                | 工作流引擎           |
|  10  | 进化        | 智能体从评分中学习，自动更新自身人设         | 自进化引擎           |

> 3D 办公室会实时显示每个智能体的状态：思考中、执行中、评审中、空闲中。

## 快速开始

### 方式一：纯体验（不需要 API Key）

打开 [在线演示](https://opencroc.github.io/cube-pets-office/)，或者本地运行：

```bash
corepack enable
pnpm install
pnpm dev:frontend
```

完整的 3D 场景、办公室驾驶舱、动态组织可视化和交互界面，全部在浏览器里运行。

### 方式二：接入 LLM（完整开发模式）

```bash
cp .env.example .env
# 编辑 .env，至少填入 LLM_API_KEY
corepack enable
pnpm install
pnpm dev:all
```

最小 `.env` 配置：

```dotenv
LLM_API_KEY=your_api_key_here
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-5.4
LLM_WIRE_API=responses

# 执行器运行模式：mock / native / real
LOBSTER_EXECUTION_MODE=native
```

`pnpm dev:all` 会同时启动前端、服务端和 Lobster 执行器。

### 方式三：可选 executor 单独启动（调试 / 真实 Docker）

```bash
# 终端 1：启动服务端
pnpm dev:server

# 终端 2：启动前端
pnpm dev:frontend

# 终端 3：单独启动执行器（mock 模式，无需 Docker）
LOBSTER_EXECUTION_MODE=mock pnpm exec tsx services/lobster-executor/src/index.ts

# 或 native 模式（本机进程执行，无需 Docker）
LOBSTER_EXECUTION_MODE=native pnpm exec tsx services/lobster-executor/src/index.ts

# 或真实 Docker 模式（需要 Docker 运行中）
LOBSTER_EXECUTION_MODE=real pnpm exec tsx services/lobster-executor/src/index.ts
```

> Windows / PowerShell 用户：可先执行 `$env:LOBSTER_EXECUTION_MODE='mock'`（或 `native` / `real`）再启动命令。

系统会把 AI 生成的执行计划下发到 Lobster 执行器，页面上实时展示执行状态、日志和产物。支持 `mock` 模式（开发调试）、`native` 模式（本机进程执行）和 `real` 模式（真实 Docker 容器执行）。

### 常见问题

**Q：启动 `dev:all` 或 `real` 模式时提示 “Docker not found” 或 Docker 无法连接？**  
A：若 Docker 不可用，系统会自动回退到 `LOBSTER_EXECUTION_MODE=native`（本机进程模式），这样整套开发环境仍能保持真实执行链路。如果你只想做纯模拟调试，也可以手动把 `.env` 里的模式设成 `mock`。

## 系统架构

下图按 2026-04-15 的项目快照更新：主干仍是前端 / Cube Brain / Intelligence / Trust / Execution / Interop 六层，但前端主路径已升级为“办公室主壳 + 内嵌任务驾驶舱”。桌面端 `/` 在同一屏里收口任务队列、`Scene3D`、右侧任务/上下文 tab、统一智能发起入口与底部共享操作区，`/tasks` 继续保留为全屏工作台与深链页。

<p align="center">
  <img src="./docs/architecture.svg" alt="Cube Pets Office Architecture" width="100%" />
</p>

### 2026-04-15 运行时更新

运行时选择逻辑已简化：

- 本地 + Docker 可达 -> `real`
- 本地无 Docker -> `native`
- GitHub Pages -> 浏览器纯前端运行时（不是 `native`）

详细文档：

- [Runtime current state](./.kiro/steering/2026-04-15-runtime-current-state.md)
- [Updated runtime architecture diagram](./docs/architecture-runtime-2026-04-15.svg)

<p align="center">
  <img src="./docs/architecture-runtime-2026-04-15.svg" alt="Cube Pets Office runtime architecture addendum" width="100%" />
</p>

## 项目代码结构

```text
cube-pets-office/
├── client/                          # 前端应用
│   └── src/
│       ├── components/              # Scene3D、office、tasks、nl-command、lineage、replay 等 UI
│       ├── lib/                     # Zustand stores、API clients、工具函数
│       ├── pages/                   # 页面级入口
│       ├── runtime/                 # 浏览器运行时
│       ├── workers/                 # snapshot-worker 等 Web Worker
│       └── i18n/                    # 中英文本地化资源
├── server/                          # 服务端
│   ├── core/                        # workflow-engine、dynamic-organization、A2A、swarm、治理逻辑
│   ├── tasks/                       # Mission runtime / store / decision
│   ├── routes/                      # REST API 路由
│   ├── audit/ replay/ lineage/      # 审计、回放、数据血缘
│   ├── knowledge/ rag/ permission/  # 知识、检索、权限
│   └── tests/                       # Vitest + fast-check
├── shared/                          # 前后端共享契约
│   ├── mission/ executor/ nl-command/
│   ├── knowledge/ lineage/ replay/
│   ├── audit/ permission/ rag/ skill/
│   └── telemetry/ llm/ demo/ export/
├── services/lobster-executor/       # 执行器
│   ├── src/index.ts                 # 执行器入口
│   ├── src/app.ts                   # HTTP API + /health
│   ├── src/docker-runner.ts         # 真实 Docker 容器生命周期
│   ├── src/mock-runner.ts           # Mock 模式（无 Docker 依赖）
│   └── src/security-*.ts            # 沙箱、安全审计、凭证注入
├── .kiro/                           # 需求与 steering
│   ├── specs/                       # requirements / design / tasks
│   └── steering/                    # 当前项目总览与执行口径
├── data/                            # 本地 JSON、回放、测试数据
├── scripts/                         # dev-all、smoke、worktree 工具
└── docs/                            # 文档与规范
```

## 功能模块完成状态

### 核心引擎

| 功能                       | 状态 | 说明                                                                         |
| -------------------------- | :--: | ---------------------------------------------------------------------------- |
| 3D 办公室 + 智能体实时状态 |  ✅  | Three.js 场景，实时显示思考 / 执行 / 评审 / 空闲                             |
| 动态组织生成               |  ✅  | 根据任务内容由 LLM 生成 CEO / 经理 / Worker 结构                             |
| 十阶段工作流管道           |  ✅  | 组建 -> 拆解 -> 规划 -> 执行 -> 评审 -> 审计 -> 修订 -> 验证 -> 汇总 -> 进化 |
| 20 分制评审 + 元审计       |  ✅  | 四维度打分，独立审计员质量检查                                               |
| 三级记忆系统               |  ✅  | 短期（会话）/ 中期（向量检索）/ 长期（SOUL.md 人设）                         |
| 自进化 + 心跳              |  ✅  | 评分分析 -> 人设修补 -> 能力注册，自主搜索趋势报告                           |
| Mission 任务状态机         |  ✅  | `receive -> understand -> plan -> provision -> execute -> finalize`          |
| 双运行时                   |  ✅  | 浏览器 IndexedDB + 服务端 Express，同一套引擎                                |

### 智能体能力

| 功能              | 状态 | 说明                                    |
| ----------------- | :--: | --------------------------------------- |
| Skill 热插拔体系  |  ✅  | 运行时注册 / 卸载技能，不重启服务       |
| 动态角色切换      |  ✅  | Agent 运行时切换角色，适应任务变化      |
| 自评估 + 竞争执行 |  ✅  | Agent 自我评估能力，竞争择优执行        |
| 信誉评分系统      |  ✅  | 基于历史表现的信誉积累与衰减            |
| 多模态编排        |  ✅  | 语音 + Vision 统一编排                  |
| 人工审批流        |  ✅  | 通用审批 + 决策链，支持暂停等待人工确认 |

### 知识与检索

| 功能                  | 状态 | 说明                                                                |
| --------------------- | :--: | ------------------------------------------------------------------- |
| 向量数据库 + RAG 管道 |  ✅  | 7 步 Pipeline：加载 -> 分块 -> 嵌入 -> 索引 -> 检索 -> 重排 -> 生成 |
| 结构化知识图谱        |  ✅  | 实体 / 关系 / 推理，支持可视化探索                                  |
| 附件输入              |  ✅  | PDF、Word、Excel、图片 OCR                                          |

### 可观测性与治理

| 功能           | 状态 | 说明                                    |
| -------------- | :--: | --------------------------------------- |
| 实时遥测仪表盘 |  ✅  | 事件总线 + Recharts 可视化              |
| 成本可观测性   |  ✅  | Token 追踪、模型定价、Agent 成本分布    |
| 主动成本治理   |  ✅  | 多级预算 / 四级告警 / 灰度降级 / 审计链 |
| 长任务恢复     |  ✅  | 浏览器端 IndexedDB 持久化，断点续跑     |
| 执行回放       |  ✅  | Mission 执行过程录制与时间线回放        |

### 交互与集成

| 功能                 | 状态 | 说明                                         |
| -------------------- | :--: | -------------------------------------------- |
| 自然语言指挥中心     |  ✅  | 自然语言 -> 结构化命令，智能路由             |
| 3D 场景 Mission 融合 |  ✅  | Mission 状态实时映射到 3D 智能体动画         |
| 跨框架导出           |  ✅  | 一键导出为 CrewAI / LangGraph / AutoGen 格式 |
| 演示引擎 + 引导体验  |  ✅  | 预录数据包 + 步骤引导，零配置体验            |
| 飞书集成             |  ✅  | ACK / Progress / 决策回传                    |
| 中英文 / 移动端      |  ✅  | i18n 双语切换，响应式布局                    |

### 执行器与安全

| 功能                    | 状态 | 说明                                                            |
| ----------------------- | :--: | --------------------------------------------------------------- |
| Docker 真实容器生命周期 |  ✅  | dockerode 容器创建 / 启动 / 日志流 / 超时 / 清理，HMAC 签名回调 |
| AI 容器能力注入         |  ✅  | API Key 安全注入、凭证脱敏、AI 任务预设模板                     |
| 安全沙箱                |  ✅  | seccomp / AppArmor 安全策略、能力裁剪、安全审计日志             |
| 容器实时终端 + 截图预览 |  ✅  | WebSocket 终端流、容器截图、3D 场景沙箱监控                     |
| Agent 权限矩阵          |  ✅  | 细粒度工具 / 资源 / 网络权限控制，RBAC 矩阵                     |

### 协作与互操作

| 功能             | 状态 | 说明                                                       |
| ---------------- | :--: | ---------------------------------------------------------- |
| 跨 Pod 自主协作  |  ✅  | 多节点 Agent 集群发现、任务委派、共识协议                  |
| A2A 互操作协议   |  ✅  | 跨框架 Agent 通信标准，CrewAI / LangGraph / AutoGen 适配器 |
| Guest Agent 市场 |  ✅  | 外部 Agent 沙箱接入、TTL 生命周期、邀请解析                |
| 不可篡改审计链   |  ✅  | 哈希链式审计日志、异常检测、合规映射                       |
| 数据血缘追踪     |  ✅  | DAG 可视化、变更检测、审计集成、多格式导出                 |

### UI 与体验

| 功能              | 状态 | 说明                                                     |
| ----------------- | :--: | -------------------------------------------------------- |
| 全息操控舱 UI     |  ✅  | 毛玻璃拟态 + 有机科幻风格，胶囊 Dock、侧边抽屉、发光 CTA |
| 3D Agent 状态融合 |  ✅  | 呼吸光晕动画、状态驱动文字颜色、glass-3d 姓名牌          |
| 科技感排版        |  ✅  | Space Grotesk 标题 + JetBrains Mono 数据字体             |

### 近期补完

| 功能                  | 状态 | 说明                                                                                                                 |
| --------------------- | :--: | -------------------------------------------------------------------------------------------------------------------- |
| 工作流产物展示与下载  |  🧪  | 功能开发已完成，当前仅剩最终检查点验收                                                                               |
| 任务取消端到端        |  ✅  | P0 已完成，取消入口、执行器中断、状态落库与 UI 回显闭环已打通                                                        |
| 任务状态操作栏        |  ✅  | P0 已完成，暂停 / 恢复 / 重试 / 标记阻塞 / 终止已统一到任务操作模型                                                  |
| 任务详情首屏重排      |  ✅  | P1 已完成，主操作、当前负责人、blocker、下一步动作已前置到第一屏                                                     |
| 执行协作文案收敛      |  ✅  | P1 已完成，界面文案已收口为“开发执行 / 协作交付 / 当前行动”                                                          |
| 任务控制台 UI 打磨    |  ✅  | P2 已完成，反馈时机、按钮层级、状态可见性、空态和错误态已统一优化                                                    |
| 发起 / 任务操作共享区 |  🧪  | `UnifiedLaunchComposer` 已接入底部任务操作 rail，`OfficeTaskCockpit` 与 `/tasks` 已完成接线，当前仅剩桌面 / 窄宽手测 |
| 办公室任务驾驶舱 V1   |  🚧  | 桌面端办公室主壳、三栏驾驶舱、右侧上下文 tab、统一智能发起入口与底部共享操作区已落地，剩余回归、补测与桌面手测       |
| i18n cleanup          |  📋  | 文案统一、国际化收口                                                                                                 |

### 规划中（平台层）

| 功能                    | 状态 | 说明                        |
| ----------------------- | :--: | --------------------------- |
| Docker Compose 生产部署 |  📋  | 一键部署完整系统            |
| 多人实时协作            |  📋  | 多用户同时操作同一 Office   |
| 多租户隔离              |  📋  | 租户级数据和资源隔离        |
| Agent 交易市场平台      |  📋  | 信誉驱动的 Agent 交易与发现 |
| K8s Agent Operator      |  📋  | Kubernetes 原生 Agent 编排  |
| 边缘部署                |  📋  | 边缘节点 Agent 运行时       |
| VR 沉浸式扩展           |  📋  | VR 头显中的 3D 办公室       |

## 项目规模

| 维度            | 数据                                                                                                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript 源码 | **989 个 `.ts` / `.tsx` 文件，约 238,309 行**                                                                                                                              |
| `.kiro/specs`   | **76 个目录**：前三层主线已基本落地，办公室驾驶舱与桌面体验继续收口中                                                                                                      |
| 共享契约        | **14 个 `shared/**/contracts.ts` 模块\*\*                                                                                                                                  |
| 测试覆盖        | **379 个测试文件**（Vitest + fast-check）                                                                                                                                  |
| 当前活跃增量    | `office-task-cockpit` 桌面回归与手测 · `launch-operator-surface-convergence` 最终桌面手测 · `workflow-artifacts-display` 最终验收 · `i18n-cleanup` 收口 · 工程基线欠账治理 |
| Commits         | **397**                                                                                                                                                                    |

## 技术栈

| 层       | 技术                                                                       |
| -------- | -------------------------------------------------------------------------- |
| 3D 场景  | Three.js · React Three Fiber · Drei                                        |
| 前端     | React 19 · Vite · TypeScript · Zustand · Recharts · shadcn/ui · Ant Design |
| 后端     | Express · Socket.IO · TypeScript                                           |
| AI 接入  | OpenAI 兼容接口（任意提供商）                                              |
| 知识检索 | 向量数据库 · RAG Pipeline · 知识图谱                                       |
| 测试     | Vitest · fast-check（属性测试）                                            |
| 存储     | 浏览器：IndexedDB / 服务端：本地 JSON                                      |
| 部署     | GitHub Pages（前端）/ Docker（执行器）                                     |

## 适合谁

| 角色      | 用途                                     |
| --------- | ---------------------------------------- |
| AI 研究者 | 探索多智能体协调模式、层级委派和评审机制 |
| 学生      | 学习智能体架构、任务分解、评估与进化     |
| 开发者    | 作为构建自己 agent 系统的可视化参考      |
| 技术博主  | 找一个有视觉冲击力的 demo 来写文章       |
| 好奇的人  | 看看让 AI 智能体经营一间办公室会发生什么 |

## 常用命令

```bash
pnpm dev:frontend   # 只启动前端（纯体验）
pnpm dev:server     # 只启动服务端
pnpm dev:all        # 启动前端 + 服务端 + 执行器
pnpm dev:stop       # 停止本地开发进程
pnpm exec tsx services/lobster-executor/src/index.ts  # 单独启动执行器
pnpm build          # 构建前端 + 服务端
pnpm build:pages    # 构建 GitHub Pages 静态产物
pnpm preview        # 预览前端构建产物
pnpm check          # TypeScript 类型检查
pnpm lint           # Prettier 检查
pnpm test           # 客户端 + 服务端 + 执行器测试
```

## 参与贡献

欢迎 PR。提交前建议运行 `pnpm check`、`pnpm lint`、`pnpm test`。如果当前分支存在进行中的类型基线问题，请至少保证不新增错误，并在提交说明里写清楚差异。

推荐从这两个文件开始了解核心逻辑：

- 工作流引擎 -> [`server/core/workflow-engine.ts`](./server/core/workflow-engine.ts)
- 浏览器运行时 -> [`client/src/runtime/browser-runtime.ts`](./client/src/runtime/browser-runtime.ts)

## 文档

| 文档                                   | 内容                                       |
| -------------------------------------- | ------------------------------------------ |
| [`.kiro/steering/`](./.kiro/steering/) | 当前项目总览、执行口径与实现指南           |
| [`.kiro/specs/`](./.kiro/specs/)       | 每个 spec 的 requirements / design / tasks |
| [`ROADMAP.md`](./ROADMAP.md)           | 开发阶段与完成状态                         |
| [`CHANGELOG.md`](./CHANGELOG.md)       | 近期变更记录                               |
| [`docs/`](./docs/)                     | 契约规范与架构说明                         |

## License

[MIT](./LICENSE) © Cube Pets Office Contributors

## Star History

<p align="center">
  <a href="https://star-history.com/#opencroc/cube-pets-office&Date">
    <img src="https://api.star-history.com/svg?repos=opencroc/cube-pets-office&type=Date" alt="Star History Chart" />
  </a>
</p>

<p align="center">
  <strong>如果这个项目对你有启发，欢迎 Star · Fork · 分享</strong><br />
  <sub>Made for the multi-agent community.</sub>
</p>
