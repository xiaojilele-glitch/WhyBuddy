<!--
 * @Author: wangchunji
 * @Date: 2026-03-31 14:56:15
 * @Description:
 * @LastEditTime: 2026-04-10 01:09:31
 * @LastEditors: wangchunji
-->

---

## inclusion: auto

## 2026-05-28 Rebrand: 端云 / WhyBuddy

This project's user-facing brand has changed from `WhyBuddy` to
`端云 / WhyBuddy`. Strategy is **alias-first, not big-bang rename**:

- User-visible touchpoints (HTML title, login, loading, README hero,
  `package.json` `name`) consume `shared/brand.ts`.
- Internal symbols (file names, module identifiers, audit / lineage event
  families, the 287 spec dirs, this steering file's older sections) keep
  their existing strings; a future `whybuddy-internal-rename` spec will
  carry out the coordinated sweep.
- The legacy package name lives on as `BRAND_PACKAGE_LEGACY` in
  `shared/brand.ts` for places that still need to reference the old token.

The name expands to `端 (edge / endpoint) + 云 (cloud)` — workloads run at
the edge when they can (browser runtime, native sandbox, your laptop's
Docker), and fall back to the cloud when they need shared coordination
(LLM, MCP servers, the Lobster Executor service).

## 2026-04-30 Project-first next phase

This project overview now treats Project-first as the next product mainline above the closed Task Autopilot Phase 1 baseline.

The user-facing chain is:

```text
Project -> Clarification -> Spec -> Route -> Execution -> Evidence
```

- `Project` is the first durable product object and the user's return point for intent, messages, specs, routes, missions, artifacts, and evidence.
- `Clarification` is project-scoped and resolves missing context, constraints, permissions, acceptance criteria, and risk boundaries.
- `Spec` turns clarified project intent into an inspectable, versioned contract for scope, deliverables, acceptance criteria, and evidence expectations.
- `Route` is planned through FSD role packages, including main, conservative, fallback, and takeover paths.
- `Execution` continues to run through the existing Mission / Workflow / Runtime / Executor stack; Project-first does not introduce a parallel runtime.
- `Evidence` writes artifacts, logs, decisions, replay records, audit facts, and delivery review back to the project context.

The 50+ AIGC nodes are internal capabilities inside FSD roles such as Planner, Clarifier, Researcher, Generator, Operator, Reviewer, and Auditor. They are not the primary user entrypoint. Tasks, workflows, Docker, browser runtime, and native runtime remain execution carriers below the Project-first product line.

## 2026-05-12 增补：Autopilot Capability Runtime 默认开启

本节只记录 `.kiro/specs/autopilot-capability-runtime-enablement` 的落地事实，不重写上文 Project-first / Task Autopilot 口径。

- Autopilot 5 条 capability bridge（`docker-analysis-sandbox` / `mcp-github-source` / `role-system-architecture` / `aigc-spec-node` / `agent-crew-stage-activation`）默认装配已从 opt-in off 翻转为 opt-out on，由新增的主开关 `AUTOPILOT_REAL_RUNTIME` 驱动；`dev:all` 脚本默认注入 `"true"`，5 条桥在依赖就位时走真实 executor / MCP / LLM 调用。
- `BUILD_TARGET=test` 仍然硬锁 5 条桥为 fallback，保留既有 5140+ 测试的默认兼容性；任一测试显式 `vi.stubEnv("BLUEPRINT_*_ENABLED", "true")` 可继续单独打开。
- `GET /api/blueprint/diagnostics` 新增为只读诊断端点，返回每条桥当前的 `real / fallback / enabled / disabled` 状态摘要（`enabledByConfig` / `dependencyReady` / `lastMode` / `lastError` / 计数器）。
- Docker 不可达、MCP 初始化失败、`apiKey` 缺失等依赖缺失场景一律走 simulated fallback，不阻塞服务器启动、也不改变 `POST /api/blueprint/jobs` / `/generations` 的响应形态；诊断端点会如实反映 fallback 原因。

## 2026-05-13 增补：Autopilot Role Container Loader

本节记录 `.kiro/specs/autopilot-role-container-loader` 的落地事实。

- `autopilot-role-container-loader` 把角色从静态目录推进为运行时复合代理：当 stage activation driver 把某 role 标记为 `active` 时，loader 为其装配一个 Docker 容器（或 lite-mode 进程沙箱）并绑定声明的 MCP / Skill / AIGC 节点；当 role 进入 `sleeping` 时释放容器并生成 stage handoff 快照。
- Real / Lite 双模式：Docker 可达时走真实容器（`dispatchPlan` + HMAC 回调），否则 lite mode 在宿主进程内执行，向上层 LLM 路径透明。
- 三级 graceful degradation：Tier 1 env gate（`BLUEPRINT_ROLE_CONTAINER_LOADER_ENABLED`）/ Tier 2 依赖缺失（executor / mcpToolAdapter / skillRegistry）/ Tier 3 运行期错误（probe 失败 / skill load 失败 / AIGC 节点 invoke 失败）均不抛错，单项跳过整体仍 ready。
- 诊断端点扩展：`GET /api/blueprint/diagnostics` 新增第 6 条 entry `roleContainerLoader`，含 `realProvisions` / `liteProvisions` / `teardownCount` / `orphanContainerWarning` 计数。
- 4 条新事件：`role.container.provisioning` / `role.container.ready` / `role.container.teardown` / `role.container.failed`，归入 `role` 家族，不扩展 12 家族目录。

详见：

- `.kiro/specs/autopilot-role-container-loader/requirements.md`
- `.kiro/specs/autopilot-role-container-loader/design.md`

## 2026-04-26 增补：Task Autopilot Phase 1 闭环

本页已经同步到 2026-04-26 的主线口径，旧阶段性文档继续保留用于历史追溯。当前需要优先记住以下事实：

- WhyBuddy 的产品口径已经从 `mission-first` 任务操作系统升级为 `task autopilot` 任务自动驾驶平台
- `mission-first` 不废弃：它仍是底层工程哲学与任务真相源，负责承载 Mission、Workflow、Runtime、Review、Audit、Replay 等主干能力
- `task autopilot` 是上层产品抽象：用户输入“目的地”，系统生成“路线”，组织“车队”，展示“驾驶状态”，并在关键点请求“接管”
- 第一阶段 `18 / 18` 份 task-autopilot specs 已完成并收口，共 `54 / 54` 份 spec markdown、`345 / 345` 顶层任务项、`602 / 602` raw checklist 项
- 第一条 compatibility-first 代码纵切已落地：shared Destination parser / autopilot summary 合同、server projection / orchestration 字段、client store normalize、TaskAutopilotPanel 驾驶舱消费面
- 本地 Docker 可用时，完整链路走 `real`
- 本地 Docker 不可用时，完整链路回退到 `native`
- GitHub Pages 只走 Browser Runtime，不属于 executor 模式
- `web-aigc` 已完成 `58 / 58` specs 与 `238 / 238` 顶层任务封板
- 主服务入口已接入 Web-AIGC routes、runtime extra adapters、workflow runtime governance 与 RAG 向量治理链路

详见：

- `.kiro/steering/2026-04-15-runtime-current-state.md`
- `.kiro/steering/task-autopilot-phase-1-closure-2026-04-26.md`
- `.kiro/steering/task-autopilot-spec-roadmap-2026-04-23.md`
- `.kiro/steering/web-aigc-58-plan-progress-summary-2026-04-22.md`
- `.kiro/steering/web-aigc-runtime-mainline-checkpoints-2026-04-23.md`
- `docs/task-autopilot-18-spec-progress-overview-2026-04-24.svg`
- `docs/architecture-runtime-2026-04-21.svg`

# WhyBuddy 项目总览

## 项目定位

一句话定义：`WhyBuddy` 是一个面向复杂任务的任务自动驾驶平台：用户输入目标、查看路线，让系统执行安全部分，并在人类判断必需时接管。

WhyBuddy 当前对内定义为：建立在 `mission-first` 底座上的 `task autopilot` 任务自动驾驶平台。

`mission-first` 任务操作系统是当前已经落地的工程底座：用户不是触发零散工具调用，而是在创建和推进一个 Mission；系统不是返回单轮答案，而是围绕 Mission 组织 Workflow、Runtime、Agent、HITL、Review、Replay、Audit、Lineage 与交付物。任务工作台、`tasks-store`、Mission Runtime、十阶段工作流、Docker executor、浏览器运行时、审计链与回放能力共同构成这层底座。

`task autopilot` 任务自动驾驶平台是在此基础上的产品升级方向：用户输入的是“目的地”而不是单次 prompt；系统生成的是“路线”而不是只给工程侧看的 workflow；Agent / 节点 / 工具被组织成可解释的“车队”；运行过程被呈现为“驾驶状态”；人工确认、澄清、审批和异常处理被统一表达为“接管点”。这不是推翻现有实现，也不是把底层对象立即改名，而是在现有主干之上增加一层面向用户、协作者和后续产品化的稳定语义。

这样定义的原因是：当前仓库已经具备 Mission Runtime、workflow runtime、wait/resume、HITL、replay、audit、lineage、Web-AIGC 节点接线、RAG 治理和真实 / 浏览器双运行时等基础能力，继续称为“多智能体可视化平台”会低估主线；但直接承诺开放域全自动又会掩盖治理、接管和证据链的重要性。因此本项目应表达为“任务自动驾驶”：默认自动规划和执行，但必须可解释、可回放、可审计、可接管。
同样，它也不应被收缩成“Agent Platform / 能力市场”的口径：Agent、工具与节点是完成任务的车队编组资源，而不是对外主卖点；对外主价值仍是任务送达、过程治理与结果可信。

## 技术栈

- 前端：React 19 + Vite + TypeScript + Zustand + Three.js (R3F) + Framer Motion
- 后端：Express + Socket.IO + TypeScript
- AI：OpenAI 兼容接口（任意提供商）
- 存储：浏览器 IndexedDB / 服务端本地 JSON
- 执行：Docker (dockerode) + seccomp/AppArmor 安全沙箱
- 测试：Vitest + fast-check (PBT)
- UI 风格：冷灰色板 + OKLCH 设计令牌 + 左侧导航 + 三栏驾驶舱布局

## 项目规模

> 体量快照时点：`2026-05-28`

- `2,130` 文件 / `~545,000` 行 TypeScript / TSX
  - server：`1,004` 文件 / `290K` 行（routes 391 / core 100 / tests 362 / feishu 13 / audit 12 / lineage 7 / tasks 7）
  - client/src：`916` 文件 / `217K` 行（components 342 / pages 314 / lib 209）
  - shared：`139` 文件 / `26K` 行
  - services：`68` 文件 / `12K` 行
- Markdown 文件 `1,074` 份；测试文件（`.test` / `.spec`）`866` 份，其中 `server/tests 362` 份
- `.kiro/specs/` 目录 `287` 个：`requirements.md 285` / `design.md 286` / `tasks.md 286` / `bugfix.md 3`
- Tasks checkbox `7,887 / 8,806`（`89.6%`），未勾选 `919`
- Git 跟踪文件 `5,152` 份，Git 提交 `748` 次
- `web-aigc` 当前形成 `58 / 58` specs 封板基线，其中包含 `52` 个节点 specs 与 `6` 个平台 specs
- `web-aigc` 顶层任务已完成 `238 / 238`，后续不再以“继续补 specs”作为主线推进指标
- `task-autopilot` 第一阶段 `18 / 18` 份 specs 已完成并收口，覆盖产品定位、核心概念、L1-L5 分级、Destination / Route、驾驶舱 IA、接管点、Drive State、runtime 编排、可解释性、恢复治理、证据回放与成功度量
- `task-autopilot` 任务跟踪口径当前为 `345 / 345` 顶层任务项与 `602 / 602` raw checklist 项，进度 SVG 已更新到 2026-04-26 口径
- `task-autopilot` 已落地第一条 shared / server / client 纵切：`parseMissionDestination()`、autopilot projection / orchestration、tasks-store normalize、TaskAutopilotPanel 消费面
- 当前产品叙事已经从“任务操作系统”进入“任务自动驾驶平台”阶段；工程主干继续 compatibility-first，不立即大规模重命名 `mission / workflow / runtime`
- 当前活跃增量已经从 spec 勾选切换到主线增强：类型债清理、runtime adapter result 统一、observability / lineage 深化、HITL / Office 面板闭环、tools-and-agents 治理字段统一
- 14 个 shared/ 契约模块，主线能力已覆盖前端、服务端、执行器、审计与互操作层
- 大量单元测试与属性测试已覆盖 Mission、执行器、RAG、审计、NL Command 等核心域

> 说明：本页以 2026-04-26 Task Autopilot Phase 1 闭环后状态为准；旧的阶段性计划文档保留用于历史追溯。Web-AIGC 封板口径见 `.kiro/steering/web-aigc-58-plan-progress-summary-2026-04-22.md`；任务自动驾驶闭环口径见 `.kiro/steering/task-autopilot-phase-1-closure-2026-04-26.md` 与 `docs/task-autopilot-18-spec-progress-overview-2026-04-24.svg`。

## 2026-04-26 增补：前端体验触发与响应式边界

- 任务自动驾驶的最小触发输入应是“目的地”句子：包含目标、约束、交付物或成功标准，而不是只输入泛化 prompt。README 已同步六类前端 chips：analysis、generation、implementation、research、attachment、advanced-execution。
- 六类 chips 是用户态定位示例，不是后端能力承诺：它们分别表达快速分析、生成交付材料、带回滚的实现、有证据的研究、基于附件的规划，以及受保护的高级执行。
- Destination parser / projection 是运行时和审计侧的丰富模型；launch preview 与 cockpit goal card 是更轻的 frontend view model。已展示字段和 parser 审计字段不应混同，避免误判为所有字段都已持久化或在所有卡片中可见。
- 桌面端主结构按三栏表达：左侧 Destination / Route，中间 Drive / Fleet / Outputs，右侧 Takeover / Evidence / Cost / Risk。tablet / mobile 通过双栏、分段导航、压缩卡片和 bottom sheet 访问同一组核心对象，但不承诺同时展示所有桌面高密度面板。
- 自动驾驶视觉方向按 Destination / Route / Fleet / Drive State / Takeover / Evidence 六类对象组织 token、状态色和动效；路线 reveal、路线选择 glow、驾驶状态 rail advance、接管提示和证据 timeline append 只用于解释进度与风险，不用于夸大自动化等级。
- GitHub Pages 预览继续按 browser-only 口径说明，不包含 Node server / executor；本地或服务端模式才覆盖完整 runtime / executor 链路。

## 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         入口层                                   │
│  用户浏览器 · 飞书 Relay · Destination 输入                      │
├─────────────────────────────────────────────────────────────────┤
│              前端层 — Task Autopilot Cockpit                     │
│  3D 场景 · HoloDock · NL 指挥中心 · 任务驾驶舱 · 成本治理面板      │
│  Route 视图 · Drive State · Takeover 面板 · 回放时间线            │
│  血缘 DAG · 审计面板 · 遥测仪表盘                                │
│  浏览器运行时 (IndexedDB + Web Worker)                           │
│  i18n (中/英) · 移动端适配 · glass-panel + spring 动效            │
├─────────────────────────────────────────────────────────────────┤
│                    Cube Brain (服务端)                            │
│  动态组织生成 · 十阶段工作流引擎 · Mission Runtime                │
│  Skill 热插拔 · 动态角色切换 · 成本治理 · 20 分评审               │
│  Guest Agent 生命周期 · RBAC 权限矩阵                            │
├─────────────────────────────────────────────────────────────────┤
│              Autopilot Projection Layer                           │
│  Mission -> Destination · Workflow -> Route                       │
│  Runtime State -> Drive State · Decision/HITL -> Takeover         │
│  Evidence · Telemetry · Success Metrics                           │
├─────────────────────────────────────────────────────────────────┤
│                    智能层                                        │
│  三级记忆 · 知识图谱 · 向量 DB + RAG 管道                        │
│  自进化引擎 · 信誉评分 · 自评估 + 竞争执行                       │
│  LLM 多提供商抽象                                                │
├─────────────────────────────────────────────────────────────────┤
│                 信任与合规层                                      │
│  哈希链式审计日志 · 数据血缘 DAG · 证据链 · 异常检测 · 合规映射    │
├─────────────────────────────────────────────────────────────────┤
│                    执行层                                        │
│  Lobster Executor (Docker 真实容器)                               │
│  HMAC 签名回调 · 安全沙箱 · 实时终端 + 截图 · AI 凭证注入        │
├─────────────────────────────────────────────────────────────────┤
│                   互操作层                                       │
│  A2A 协议 (CrewAI/LangGraph/AutoGen 适配器)                      │
│  跨 Pod 自主协作 (Swarm) · Guest Agent 市场                      │
├─────────────────────────────────────────────────────────────────┤
│                   持久化层                                       │
│  database.json · Mission 快照 · Agent 工作空间                    │
│  IndexedDB (浏览器端) · 审计日志 · 血缘图存储                     │
└─────────────────────────────────────────────────────────────────┘
```

> 当前任务真相源仍为 `tasks-store` 与 Mission 数据流；`task autopilot` 是上层投影与产品语义，不改变 `/tasks` 深链。后续桌面端主路径将继续收敛为“办公室壳 + 内嵌驾驶舱”，但底层仍以 Mission / Workflow / Runtime 承接执行真实性。

## 模块完成状态

### ✅ 已落地主线能力（能力视角）

| 模块              | 说明                                              |
| ----------------- | ------------------------------------------------- |
| 十阶段工作流引擎  | 组建→拆解→规划→执行→评审→审计→修订→验证→汇总→进化 |
| 动态组织生成      | LLM 驱动 CEO/经理/Worker 结构生成                 |
| 三级记忆系统      | 短期(会话) / 中期(向量检索) / 长期(SOUL.md)       |
| 自进化 + 心跳     | 弱维度分析→人设修补→能力注册                      |
| Mission Runtime   | 六阶段状态机 + 编排器                             |
| 飞书集成          | ACK/进度/决策回传                                 |
| 纯前端运行时      | IndexedDB + Web Worker，同一套引擎                |
| 3D 场景           | Three.js R3F，Agent 状态实时映射                  |
| 预录演示数据引擎  | 预录数据包 + 序列化/反序列化                      |
| 演示引导体验      | 回放引擎 + 步骤引导 UI                            |
| 3D Mission 融合   | Mission 状态映射到 3D 场景动画                    |
| 跨框架导出        | CrewAI / LangGraph / AutoGen 一键导出             |
| 实时遥测仪表盘    | 事件总线 + Recharts 可视化                        |
| 成本可观测性      | Token 追踪 + 模型定价 + Agent 成本分布            |
| 长任务恢复        | IndexedDB 持久化，断点续跑                        |
| 执行回放          | Mission 执行过程录制与时间线回放                  |
| 多模态视觉        | 图片理解 + 前端附件扩展                           |
| Workflow 解耦     | tasks-store mission-native 单源架构               |
| Mission 原生投影  | /api/planets 路由 + 前端数据源切换                |
| Skill 热插拔      | 运行时注册/卸载技能                               |
| 动态角色切换      | Agent 运行时角色适应                              |
| 人工审批流        | 通用审批 + 决策链                                 |
| 知识图谱          | 实体/关系/推理 + 可视化                           |
| 向量 DB + RAG     | 7 步 Pipeline                                     |
| Web-AIGC 主线入口 | 58 份 specs 封板，主服务入口已挂载节点路由与 runtime extra adapters |
| Web-AIGC Runtime  | built-in + extra adapters + wait/resume + replay/audit observability |
| 自然语言指挥中心  | NL→结构化命令，智能路由                           |
| 自评估 + 竞争执行 | Agent 自我评估，竞争择优                          |
| 信誉评分          | 历史表现积累与衰减                                |
| 多模态编排        | 语音 + Vision 统一编排                            |
| 主动成本治理      | 多级预算/四级告警/灰度降级                        |
| Docker 真实容器   | dockerode 生命周期 + HMAC 回调                    |
| AI 容器注入       | API Key 安全注入 + 凭证脱敏                       |
| 安全沙箱          | seccomp/AppArmor + 能力裁剪                       |
| 实时终端 + 截图   | WebSocket 终端流 + 容器截图                       |
| 执行器集成        | WorkflowEngine ↔ Docker 桥接                      |
| Agent 权限矩阵    | RBAC 细粒度权限控制                               |
| 跨 Pod 自主协作   | Swarm 发现/委派/共识                              |
| 不可篡改审计链    | 哈希链式日志 + 异常检测                           |
| 数据血缘追踪      | DAG 采集/查询/导出 + 审计集成                     |
| A2A 互操作协议    | 跨框架 Agent 通信 + 适配器                        |
| Guest Agent 市场  | 外部 Agent 沙箱接入 + TTL                         |
| UI 改造 8 specs    | 冷灰色板 + 左侧导航 + 任务卡片 + 右侧面板 + 发起浮层 + 3D 适配 + 状态指示器 + 响应式回归 |
| 任务自动驾驶定位  | 从 mission-first 任务操作系统升级为 task autopilot 产品口径 |
| Autopilot 第一阶段 specs | 18 份 specs 已完成并收口，形成产品、对象、交互、runtime、治理与迁移层口径 |

### 📍 当前进度快照（Task Autopilot 视角，2026-04-26）

| 维度 | 当前状态 | 说明 |
| ---- | -------- | ---- |
| 产品定位 | 已升级 | 项目总览口径从“多智能体可视化平台 / mission-first 任务系统”升级为“task autopilot 任务自动驾驶平台” |
| 工程底座 | 继续保留 | `Mission / Workflow / Runtime / HITL / Review / Replay / Audit / Lineage` 仍是底层事实对象 |
| 第一阶段 specs | `18 / 18` | P0 产品定义、P1 驾驶舱交互、P2 runtime 与治理增强均已完成并收口 |
| 文档产物 | `54 / 54` 份 markdown | 每个 spec 均包含 `requirements.md`、`design.md`、`tasks.md` |
| 核心任务项 | `345 / 345` | 按 18 个 specs 的 `tasks.md` 顶层任务行统计 |
| raw checklist | `602 / 602` | 按 18 个 specs 的 `tasks.md` 全量 checkbox token 统计 |
| 代码纵切 | 已落地 | shared Destination parser / autopilot summary、server projection / orchestration、client normalize、TaskAutopilotPanel |
| 概念映射 | 已统一 | `Mission -> Destination`、`Workflow -> Route`、`Runtime State -> Drive State`、`Decision / HITL -> Takeover` |
| 下一轮重点 | 待深化 | parser 版本化、clarification merge、route planner 自动编队、fleet orchestration、evidence replay trust chain 与 success metrics |

- `task autopilot` 不是新建一套孤立 runtime，而是把现有 runtime、replay、audit、lineage、HITL 和 Web-AIGC 节点接线组织成一条可解释的任务送达主线。
- 第一阶段不追求开放域 L5 全自动执行，而是先建立 L1-L3 可产品化表达：自动规划、受治理执行、关键点接管、结果可验证。
- Web-AIGC 的 58 份 specs 是能力与节点基座；task-autopilot 的 18 份 specs 是产品抽象、驾驶舱体验、runtime 投影和治理解释层。
- 后续实现应继续深化投影层、解释层和驾驶舱消费层，避免用底层大规模改名替代产品建模。

### 📍 当前进度快照（Web-AIGC 视角，2026-04-23）

| 维度 | 当前状态 | 说明 |
| ---- | -------- | ---- |
| specs 封板 | `58 / 58` | `52` 个节点 specs + `6` 个平台 specs 已完成 |
| 顶层任务 | `238 / 238` | 仅统计 `web-aigc-* / tasks.md` 顶层 checklist |
| 主服务入口 | 已接线 | `server/index.ts` 已挂载 Web-AIGC route 面与 runtime extra adapters 注册面 |
| runtime 主线 | 已具备最小平台执行主干 | built-in adapters、extra adapters、wait/resume、audit/replay observability 已形成主线基线 |
| RAG 与向量治理 | 已补线 | `metadataStore / vectorStore` 可被向量更新、删除与 risk-actions 复用 |
| workflow 治理入口 | 已补线 | runtime governance 入参与 `open-report` 子路由已进入 `/api/workflows` |

- `web-aigc` spec 完成度已经封板，后续 steering 不再用“新增多少 specs / checklist”衡量主线进度。
- 主服务入口已覆盖 MCP、搜索问答、Office / 内容生产、多模态识别、高风险动作、宿主打开动作、向量更新 / 删除等节点族。
- runtime 主线已经形成 built-in、extra adapters、wait/resume、audit/replay 四个最小执行与治理层。
- 在 `task autopilot` 口径下，Web-AIGC 节点不直接作为用户主入口暴露，而是被包装为 Route 阶段、Fleet 能力、Takeover 风险点与 Evidence 来源。
- 当前后续重点是内部收敛：类型债、runtime adapter result、observability / lineage、HITL / Office 前端闭环、tools-and-agents 治理字段。

### 📋 待收尾 / 待深化 / 待环境就绪

| 模块 | 当前口径 |
| ---- | -------- |
| 类型债清理 | `node --run check` 仍有历史类型债，需按共享契约、runtime adapter、route contract 分批收口 |
| runtime adapter result 统一 | 需要统一 `success / blocked / needs_approval / failed` 与 `output / audit / lineage / error` 结果壳 |
| observability / lineage 深化 | 需要把节点执行、工具调用、向量写路径、`open-report` 与 audit trail 串成统一证据链 |
| HITL / Office 面板闭环 | 需要对齐 `DecisionPanel / DecisionHistory / tasks-store / mission-client` 与主线 runtime 投影 |
| tools-and-agents 治理字段统一 | 需要对账 `a2a / auto-agent / internal_api / guest-agents / skills / mcp` 的 actor、source、policy、approval、audit、lineage 字段 |
| 发布与部署扩展 | Docker Compose、多人协作、多租户、K8s Operator、边缘部署、多区域灾备、VR 等仍属于后续扩展层 |

## 工程健康快照

- 当前近端增量集中在 Web-AIGC 主线接线后的内部收敛，以及 task-autopilot 第一阶段 specs 完成后的投影层落地；不再集中在 spec 数量增长。
- 产品语言可以升级为 `Destination / Route / Drive State / Fleet / Takeover / Evidence`，但工程代码仍优先保留 `Mission / Workflow / Runtime / Decision / Audit / Replay` 主干，避免概念升级演变成高风险重命名。
- `node --run check` 当前仍有历史 TypeScript 类型债，主要分布在 HITL 附件类型、runtime extra adapter result、guest-agents、NL Command、command-list / recommended-commands node adapter、risk-actions 和 MCP tool adapter 等区域。
- 后续增量工作建议以“不扩大现有 TypeScript 基线错误数”为最低要求，并单独安排一轮类型清债。

## 核心数据流

### 预演主线（Frontend Mode）

```
用户 → 浏览器运行时 (browser-runtime.ts)
     → BrowserWorkflowRepository (内存)
     → BrowserAgentDirectory → browser-llm.ts (fetch 直连 LLM)
     → BrowserEventEmitter (回调) → Zustand → React UI
     → IndexedDB 持久化
```

### 执行主线（Advanced Mode）

```
用户 → POST /api/workflows → WorkflowEngine.startWorkflow()
     → 动态组织生成 (LLM) → WorkflowOrganizationSnapshot
     → 十阶段管道 (direction→planning→execution→review→meta_audit→revision→verify→summary→feedback→evolution)
     → Socket.IO 事件 → Zustand → React UI
     → database.json + Agent 工作空间持久化
```

### Mission 执行链路

```
用户/飞书 → POST /api/tasks → MissionStore.create()
          → MissionOrchestrator.startMission()
          → ExecutionPlanBuilder.build() → 结构化 ExecutionPlan
          → ExecutorClient.dispatchPlan() → POST /api/executor/jobs (Docker 执行器)
          → /api/executor/events (HMAC 签名回调) → MissionStore 状态更新
          → Socket mission_event → 前端任务驾驶舱实时展示
          → FeishuProgressBridge → 飞书 ACK/进度/完成/失败回传
```

### 记忆与进化链路

```
工作流执行中：
  Agent.invoke() → SessionStore.appendLLMExchange() (短期记忆)
  MessageBus.send() → SessionStore.appendMessageLog() (双方记录)

工作流完成后：
  materializeWorkflowMemories() → VectorStore.upsertMemorySummary() (中期记忆)
  EvolutionService.evolveWorkflow() → SoulStore.appendLearnedBehaviors() (长期记忆)
  CapabilityRegistry.registerWorkflow() → agent_capabilities 表

定时心跳：
  HeartbeatScheduler.trigger() → search() → LLM 总结 → 报告落盘
```

### 审计与血缘链路

```
每个工作流动作：
  AuditCollector.capture() → AuditChain.append() (哈希链式日志)
  → AnomalyDetector.analyze() → 异常告警
  → Socket audit_event → 前端审计面板实时展示

数据变更：
  LineageCollector.track() → LineageStore.addNode/addEdge() (DAG 图)
  → ChangeDetectionService.diff() → 变更记录
  → LineageAuditService → 审计链集成
  → Socket lineage_event → 前端血缘 DAG 可视化
```

### 跨框架互操作链路

```
外部 Agent 接入：
  POST /api/agents/guest → GuestInvitationParser.parse() → GuestLifecycle.spawn()
  → 沙箱运行时 (TTL 限制) → 参与工作流执行 → GuestLifecycle.teardown()

A2A 协议通信：
  A2AServer.handleTask() → 路由到内部 Agent
  A2AClient.delegateTask() → 发送到外部框架 (CrewAI/LangGraph/AutoGen)
  → 适配器转换协议格式 → 结果回传到工作流引擎

Swarm 协作：
  SwarmOrchestrator.discover() → Pod 发现
  → SwarmOrchestrator.delegate() → 跨 Pod 任务委派
  → 共识协议 → 结果聚合
```

## 项目目录结构

```
whybuddy/
├── client/                          # 🖥️ 前端应用
│   ├── src/
│   │   ├── components/
│   │   │   ├── Scene3D.tsx          # Three.js 3D 办公室场景
│   │   │   ├── HoloDock.tsx         # 全息胶囊 Dock 导航栏
│   │   │   ├── HoloDrawer.tsx       # 全息侧边抽屉容器
│   │   │   ├── WorkflowPanel.tsx    # 工作流进度面板
│   │   │   ├── ChatPanel.tsx        # 聊天面板
│   │   │   ├── ConfigPanel.tsx      # 配置面板
│   │   │   ├── CostDashboard.tsx    # 成本可观测看板
│   │   │   ├── TelemetryDashboard.tsx # 实时遥测仪表盘
│   │   │   ├── AuditPanel.tsx       # 审计日志面板
│   │   │   ├── AuditTimeline.tsx    # 审计时间线
│   │   │   ├── AuditChainVerifier.tsx # 审计链完整性验证
│   │   │   ├── AnomalyAlertPanel.tsx # 异常检测告警
│   │   │   ├── LoadingScreen.tsx    # 全息加载页
│   │   │   ├── ExportDialog.tsx     # 跨框架导出对话框
│   │   │   ├── three/               # Three.js 子组件
│   │   │   │   ├── PetWorkers.tsx   # Agent 宠物 + glass-3d 姓名牌
│   │   │   │   ├── MissionIsland.tsx # Mission 状态岛
│   │   │   │   ├── SandboxMonitor.tsx # 沙箱监控
│   │   │   │   ├── CrossPodParticles.tsx # Swarm 跨 Pod 粒子
│   │   │   │   └── CrossFrameworkParticles.tsx # A2A 跨框架粒子
│   │   │   ├── lineage/             # 数据血缘可视化
│   │   │   │   ├── LineageDAGView.tsx
│   │   │   │   ├── LineageHeatmap.tsx
│   │   │   │   └── LineageTimeline.tsx
│   │   │   ├── knowledge/           # 知识图谱可视化
│   │   │   ├── rag/                 # RAG 管道界面
│   │   │   ├── replay/              # 执行回放组件
│   │   │   ├── reputation/          # 信誉评分展示
│   │   │   ├── nl-command/          # 自然语言指挥中心
│   │   │   ├── permissions/         # 权限管理界面
│   │   │   ├── sandbox/             # 沙箱终端预览
│   │   │   ├── tasks/               # 任务驾驶舱
│   │   │   ├── demo/                # 演示引导组件
│   │   │   └── ui/                  # shadcn/ui + GlowButton
│   │   ├── lib/                     # Zustand stores + 工具
│   │   │   ├── store.ts             # 全局 store
│   │   │   ├── workflow-store.ts    # 工作流 store
│   │   │   ├── tasks-store.ts       # Mission store (mission-native)
│   │   │   ├── audit-store.ts       # 审计 store
│   │   │   ├── lineage-store.ts     # 血缘 store
│   │   │   ├── swarm-store.ts       # Swarm store
│   │   │   ├── a2a-store.ts         # A2A store
│   │   │   ├── browser-llm.ts       # 浏览器端 LLM 直连
│   │   │   └── browser-runtime-storage.ts # IndexedDB 持久化
│   │   ├── pages/
│   │   │   ├── Home.tsx             # 首页 (3D + HoloDock + HoloDrawer)
│   │   │   ├── tasks/               # 任务驾驶舱页面
│   │   │   └── lineage/             # 血缘追踪页面
│   │   ├── runtime/
│   │   │   └── browser-runtime.ts   # 浏览器端 WorkflowRuntime
│   │   ├── hooks/                   # React Hooks
│   │   ├── i18n/                    # 中英文国际化
│   │   └── contexts/                # React Context
│   └── public/                      # 静态资源 + 3D 模型
│
├── server/                          # 🧠 服务端
│   ├── core/
│   │   ├── workflow-engine.ts       # 十阶段工作流引擎
│   │   ├── dynamic-organization.ts  # 动态组织生成器
│   │   ├── mission-orchestrator.ts  # Mission 编排器
│   │   ├── swarm-orchestrator.ts    # 跨 Pod 自主协作
│   │   ├── a2a-server.ts           # A2A 协议服务端
│   │   ├── a2a-client.ts           # A2A 协议客户端
│   │   ├── a2a-adapters/           # CrewAI/LangGraph/AutoGen 适配器
│   │   ├── guest-agent.ts          # Guest Agent 管理
│   │   ├── guest-lifecycle.ts      # Guest Agent 沙箱运行时
│   │   ├── agent.ts                # Agent 基类
│   │   ├── registry.ts             # 智能体注册表
│   │   ├── message-bus.ts          # 层级消息总线
│   │   ├── evolution.ts            # 自进化引擎
│   │   ├── heartbeat.ts            # 心跳调度器
│   │   ├── skills/                 # Skill 热插拔
│   │   ├── roles/                  # 动态角色系统
│   │   ├── reputation/             # 信誉评分
│   │   ├── autonomy/               # 自评估 + 竞争执行
│   │   ├── governance/             # 成本治理子系统
│   │   ├── knowledge-graph/        # 知识图谱引擎
│   │   ├── rag/                    # RAG Pipeline
│   │   └── memory/                 # 三级记忆系统
│   ├── audit/                       # 🛡️ 审计子系统
│   │   ├── audit-chain.ts          # 哈希链式审计日志
│   │   ├── audit-collector.ts      # 事件采集器
│   │   ├── anomaly-detector.ts     # 异常检测
│   │   ├── audit-verifier.ts       # 链完整性验证
│   │   ├── audit-query.ts          # 审计查询
│   │   ├── audit-export.ts         # 审计导出
│   │   ├── compliance-mapper.ts    # 合规映射
│   │   └── timestamp-provider.ts   # 时间戳服务
│   ├── lineage/                     # 📊 数据血缘
│   │   ├── lineage-collector.ts    # 数据流采集
│   │   ├── lineage-store.ts        # 图存储
│   │   ├── lineage-query.ts        # 血缘查询
│   │   ├── lineage-export.ts       # DOT/JSON/CSV 导出
│   │   ├── lineage-audit.ts        # 审计集成
│   │   └── change-detection.ts     # 变更检测
│   ├── routes/                      # REST API 路由
│   │   ├── audit.ts                # /api/audit/*
│   │   ├── lineage.ts              # /api/lineage/*
│   │   ├── a2a.ts                  # /api/a2a/*
│   │   ├── guest-agents.ts         # /api/agents/guest/*
│   │   └── ...                     # workflows/tasks/chat/config 等
│   ├── feishu/                      # 飞书集成
│   ├── tasks/                       # Mission 状态机
│   └── tests/                       # 测试套件 (Vitest + fast-check)
│
├── shared/                          # 📦 前后端共享契约
│   ├── audit/contracts.ts           # 审计契约
│   ├── lineage/contracts.ts         # 血缘契约
│   ├── a2a-protocol.ts             # A2A 协议契约
│   ├── swarm.ts                    # Swarm 契约
│   ├── guest-agent-utils.ts        # Guest Agent 工具
│   ├── mission/contracts.ts         # Mission 契约
│   ├── llm/contracts.ts            # LLM 多提供商抽象
│   ├── rag/contracts.ts            # RAG Pipeline 契约
│   ├── skill/contracts.ts          # Skill 注册契约
│   ├── export/contracts.ts         # 跨框架导出契约
│   ├── cost.ts                     # 成本类型 + 定价表
│   └── cost-governance.ts          # 成本治理类型
│
├── services/
│   └── lobster-executor/            # 🐳 Docker 参考执行器
│       ├── src/
│       │   ├── docker-runner.ts     # 真实 Docker 容器生命周期
│       │   ├── mock-runner.ts       # Mock 模式
│       │   ├── security-policy.ts   # 安全沙箱策略
│       │   └── credential-*.ts      # AI 凭证注入/脱敏
│       └── ai-bridge/               # 容器内 AI 通信桥接
│
├── data/                            # 运行时数据（gitignored）
├── scripts/                         # 开发脚本
├── docs/                            # 文档 + 架构图
└── .kiro/                           # Kiro 规范
    ├── steering/                    # 引导文件
    │   ├── project-overview.md      # 本文件
    │   └── execution-plan.md        # 执行计划与依赖分析
    └── specs/                       # Spec 归档；Web-AIGC 58 份 specs 已封板
```

## REST API 总览

### 工作流

| 方法 | 路径                      | 说明           |
| ---- | ------------------------- | -------------- |
| POST | /api/workflows            | 启动新工作流   |
| GET  | /api/workflows            | 工作流列表     |
| GET  | /api/workflows/:id        | 工作流详情     |
| GET  | /api/workflows/:id/report | 下载工作流报告 |

### Mission

| 方法 | 路径                    | 说明                            |
| ---- | ----------------------- | ------------------------------- |
| POST | /api/tasks              | 创建 Mission                    |
| GET  | /api/tasks              | Mission 列表                    |
| GET  | /api/tasks/:id          | Mission 详情                    |
| GET  | /api/tasks/:id/events   | Mission 事件流                  |
| POST | /api/tasks/:id/decision | 提交决策（幂等）                |
| POST | /api/executor/events    | 执行器回调（HMAC 签名）         |
| GET  | /api/planets            | Planet 列表（Mission 原生投影） |
| GET  | /api/planets/:id        | Planet 详情                     |

### 审计与血缘

| 方法 | 路径                    | 说明                    |
| ---- | ----------------------- | ----------------------- |
| GET  | /api/audit/entries      | 审计日志查询            |
| GET  | /api/audit/verify       | 审计链完整性验证        |
| GET  | /api/audit/anomalies    | 异常检测结果            |
| POST | /api/audit/export       | 审计日志导出            |
| GET  | /api/lineage/nodes      | 血缘节点查询            |
| GET  | /api/lineage/graph      | 血缘 DAG 图查询         |
| GET  | /api/lineage/impact/:id | 影响分析                |
| POST | /api/lineage/export     | 血缘导出 (DOT/JSON/CSV) |

### 互操作

| 方法   | 路径                  | 说明             |
| ------ | --------------------- | ---------------- |
| POST   | /api/a2a/tasks        | A2A 任务接收     |
| GET    | /api/a2a/agents       | A2A Agent 发现   |
| POST   | /api/agents/guest     | 创建 Guest Agent |
| GET    | /api/agents/guest     | Guest Agent 列表 |
| DELETE | /api/agents/guest/:id | 移除 Guest Agent |

### 智能体与知识

| 方法 | 路径               | 说明            |
| ---- | ------------------ | --------------- |
| GET  | /api/agents        | 智能体列表      |
| GET  | /api/config/ai     | AI 配置（只读） |
| POST | /api/chat          | 服务端聊天代理  |
| GET  | /api/reports/\*    | 报告查询        |
| GET  | /api/rag/\*        | RAG 管道查询    |
| GET  | /api/knowledge/\*  | 知识图谱查询    |
| GET  | /api/telemetry/\*  | 遥测数据查询    |
| GET  | /api/cost/\*       | 成本数据查询    |
| GET  | /api/reputation/\* | 信誉评分查询    |

### Web-AIGC 主线入口

| 能力组 | 主要路径 | 说明 |
| ------ | -------- | ---- |
| 对话与回复 | `/api/chat`、`/api/robot-reply` | 对话节点、机器人回复与 runtime `documentSearch` 注入入口 |
| MCP 与工具 | `/api/mcp` | MCP 节点执行入口，复用 `McpChecker`、`McpToolAdapter` 与 `InternalMcpToolInvoker` |
| 搜索与问答 | `/api/web-search`、`/api/web-qa`、`/api/graph-search` | Web 搜索、网页问答、图谱检索与知识问答相关接线 |
| Office / 内容生产 | `/api/ai-ppt`、`/api/dynamic-chart`、`/api/excel-read`、`/api/file-generation`、`/api/file-slicing`、`/api/file-translation`、`/api/format-output` | PPT、图表、Excel、文件生成 / 切片 / 翻译与格式化输出 |
| 多模态与内容理解 | `/api/audio-recognition`、`/api/image-search`、`/api/intent-recognition`、`/api/long-text-extraction`、`/api/ocr-recognition`、`/api/similarity-match`、`/api/static-webpage-read` | 语音、图像、意图、长文本、OCR、相似度与静态网页读取 |
| 高风险与控制动作 | `/api/transaction-flow`、`/api/orchestration-recognition-jump`、`/api/vector-update`、`/api/vector-delete`、`/api/rag/risk-actions` | 事务流、编排识别跳转、向量更新 / 删除与 RAG 风险动作 |
| 宿主动作与环境信息 | `/api/open-page`、`/api/open-dashboard`、`/api/get-location-info`、`/api/get-device-info`、`/api/workflows/open-report` | 打开页面、仪表盘、位置 / 设备信息与开放报告 |

### 飞书

| 方法 | 路径                | 说明                |
| ---- | ------------------- | ------------------- |
| POST | /api/feishu/relay   | OpenClaw Relay 入口 |
| POST | /api/feishu/webhook | 飞书 Webhook 回调   |

## 开发规范

- TypeScript 严格模式仍是目标；当前 `node --run check` 仍有历史类型债，新增改动应避免扩大错误面，并优先补定向测试
- 智能体工作空间隔离：`server/core/access-guard.ts` 强制路径校验，拒绝 `..` 遍历
- 消息总线层级约束：CEO ↔ Manager ↔ Worker 不允许越级，规则在 `shared/message-bus-rules.ts`
- `.env` 为唯一配置真源，前端配置面板只读
- 运行时数据（sessions/memory/reports/SOUL.md）不进 Git
- 工作流引擎通过 `WorkflowRuntime` 抽象接口与环境解耦
- LLM 调用失败时通过 `isTemporaryLLMError()` 检测并重试
- 评审评分 LLM 返回异常时使用默认评分（每项 3 分，总分 12）
- 审计日志不可删除，只能追加，哈希链保证完整性
- Guest Agent 必须在沙箱中运行，TTL 到期自动清理
- UI 组件使用 glass-panel / glass-panel-strong / glass-3d 工具类
- 标题字体 DM Sans / Noto Sans SC (--font-display)，数据字体 JetBrains Mono (--font-mono)

## 环境变量分组

| 配置组       | 关键变量                                                | 说明                                |
| ------------ | ------------------------------------------------------- | ----------------------------------- |
| 基础运行     | `PORT`、`NODE_ENV`                                      | 默认 3001、development              |
| 主 LLM       | `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`              | 任意 OpenAI 兼容提供商              |
| Fallback LLM | `FALLBACK_LLM_*`                                        | 主模型不可用时的兜底                |
| Vision LLM   | `VISION_LLM_*`                                          | 视觉分析专用模型                    |
| Voice        | `TTS_*`、`STT_*`                                        | 语音服务，未配置回退 Web Speech API |
| Executor     | `LOBSTER_EXECUTOR_BASE_URL`、`EXECUTOR_CALLBACK_SECRET` | Docker 执行器                       |
| 飞书         | `FEISHU_ENABLED`、`FEISHU_MODE`、`FEISHU_RELAY_SECRET`  | 默认 mock                           |

## 常用命令

```bash
pnpm run dev:frontend   # 只启动前端（纯体验，不需要 .env）
pnpm run dev:all        # 启动前端 + 服务端（完整模式）
pnpm run dev:stop       # 停止本地开发进程
pnpm run build:pages    # 构建 GitHub Pages 静态产物
node --run check        # TypeScript 类型检查；当前仍有历史类型债
```
