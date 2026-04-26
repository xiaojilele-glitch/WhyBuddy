<p align="center">
  <img src="./docs/assets/banner.png" alt="Cube Pets Office 横幅" width="100%" />
</p>

<h1 align="center">Cube Pets Office</h1>

<p align="center">
  <a href="./README.md"><strong>English</strong></a> |
  <a href="./README.zh-CN.md"><strong>简体中文</strong></a>
</p>

<p align="center">
  <strong>面向 AI Agent 的任务自动驾驶平台</strong><br/>
  Cube Pets Office 是一个面向复杂任务的任务自动驾驶平台：用户输入目标、查看路线，让系统执行安全部分，并在人类判断必需时接管。
</p>

<p align="center">
  <a href="https://opencroc.github.io/cube-pets-office/"><strong>在线演示</strong></a>
</p>

<p align="center">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-111827" />
  <img alt="frontend" src="https://img.shields.io/badge/frontend-React%2019%20%2B%20Vite-2563eb" />
  <img alt="server" src="https://img.shields.io/badge/server-Node%20%2B%20Express-0f766e" />
  <img alt="executor" src="https://img.shields.io/badge/executor-Lobster-7c3aed" />
  <img alt="3d" src="https://img.shields.io/badge/3D-Three.js-f97316" />
  <img alt="autopilot%20specs" src="https://img.shields.io/badge/task--autopilot%20specs-18%2F18-0f766e" />
  <img alt="pages" src="https://img.shields.io/badge/demo-GitHub%20Pages-0ea5e9" />
</p>

---

## 它是什么

Cube Pets Office 的主叙事正在从“任务操作系统”升级为“任务自动驾驶平台”。

用户不再只是输入 prompt 等待一段回答，而是给出一个想要到达的目标。系统围绕这个目标完成理解、规划、编队、执行、澄清、复核和交付，并在风险、权限、预算、上下文不足或结果不确定时请求人类接管。

它也不是以展示 Agent、工具和插件清单为主的能力市场。Agent、工具和节点仍然重要，但它们应被收敛到路线执行、接管治理和结果送达之下，而不是成为对外产品中心。

这个方向不是要把当前系统包装成已经完全实现的开放域 L4 / L5 自动驾驶。更准确地说，Cube Pets Office 当前已经具备 mission-first 的运行底座，任务自动驾驶是建立在这套底座之上的产品语义层和后续工程演进方向。

它重点解决的是：

- 把用户目标从一句自然语言整理成可执行的任务目的地。
- 把执行过程从黑盒回答变成可观察的路线、阶段和状态。
- 把 Agent、工具、节点和执行器组织成面向结果的角色车队。
- 把澄清、审批、权限、预算和异常恢复统一成接管机制。
- 把日志、产物、审计、血缘和回放串成可复盘的证据链。

它不承诺的是：

- 不承诺所有开放域复杂任务都能无人值守完成。
- 不承诺绕过人工确认执行高风险、外部副作用或权限敏感动作。
- 不把底层 `mission / workflow / runtime` 立即大规模改名为新词汇。
- 不把“自动驾驶”用作纯营销词，而是要求能落到对象、界面、运行时和治理链路上。

---

## Mission-First 底座

任务自动驾驶不是对现有 mission-first 方向的推翻，而是它的上位产品表达。

当前仓库已经形成的基础能力包括：

- 办公室主壳与 `/tasks` 任务工作台，用于发起、观察和管理任务。
- Mission Runtime 与工作流引擎，用于承载任务状态、阶段推进和执行控制。
- Lobster Executor 与 mock / native / real 三种执行模式，用于连接真实或本地可用的执行链路。
- human-in-the-loop、wait / resume、review、audit、revision、verify 等协作和治理能力。
- replay、lineage、evidence、telemetry 等可观察与复盘能力。
- Web-AIGC 主线 specs 与 adapters，为内容生产、检索问答、Office、MCP 和高风险动作治理提供能力基础。

因此，新的自动驾驶语言会优先作为“产品语义投影层”出现：

| 产品语义 | 工程底座 | 含义 |
| ---- | ---- | ---- |
| Destination | Mission | 用户真正想送达的目标、约束、成功标准和预期交付物 |
| Route | Workflow | 系统建议或选择的执行路线、阶段、风险点和接管点 |
| Drive State | Runtime State | 当前任务处于理解、规划、执行、复核、阻塞、重规划或已交付等状态 |
| Fleet | Agent / Skill / Node / Executor | 为当前路线临时组织起来的角色编队和能力组合 |
| Takeover | Decision / HITL / Approval | 需要用户确认、补充上下文、授权、审批或恢复执行的关键点 |

这意味着工程层可以继续保持稳定，产品层逐步提供更清晰的用户态表达。后续是否进行更深层的领域重构，需要基于实际使用和代码落地效果判断。

---

## 核心概念

### Destination

Destination 是用户想要送达的结果，而不只是原始输入。它包含目标概述、背景、约束、成功标准、预期交付物和缺失信息。系统后续会围绕 Destination 做解析、澄清和任务建模。

### Route

Route 是系统为到达 Destination 生成的执行路线。它不是简单的 DAG 展示，而是面向用户解释“系统打算如何完成任务”：有哪些阶段、哪些步骤可以并行、哪些风险需要注意、哪些位置可能需要接管。

### Fleet

Fleet 是围绕 Route 自动组织起来的角色编队。底层可以由 Agent、技能、Web-AIGC 节点、工具、执行器和治理模块组成；对用户而言，它呈现为 Planner、Researcher、Generator、Reviewer、Auditor、Operator 等可理解的角色分工。

### Drive State

Drive State 是任务当前所处的驾驶状态。它把分散的 mission 状态、workflow 阶段、node run、review、audit 和 replay 信号，投影为更容易理解的状态，例如 understanding、planning、executing、reviewing、takeover-required、replanning、delivered。

### Takeover

Takeover 是人类接管点。它统一承接澄清问题、路线选择、预算确认、权限授权、风险审批、输出验收和异常恢复。自动驾驶不是无人黑盒，接管能力是平台可信运行的一部分。

---

## 自动化等级边界

任务自动驾驶 specs 已定义 L1 到 L5 的分级语言，用于防止过度承诺：

| 等级 | 定位 | 当前口径 |
| ---- | ---- | ---- |
| L1 | 路线建议级 | 系统理解目标、推荐路线和角色编组，用户确认后再执行 |
| L2 | 部分自动执行级 | 系统自动推进低风险步骤，关键节点、权限、预算和外部副作用需要接管 |
| L3 | 标准任务自动闭环级 | 在中低风险、可审计、可回放的标准任务中，系统可完成较多自动闭环 |
| L4 | 限定任务域高自动化级 | 只适用于白名单场景和强治理边界内的未来目标 |
| L5 | 开放任务域全自动级 | 远期概念和研究目标，当前仓库不宣称已具备 |

当前 README 中的“任务自动驾驶平台”指的是产品方向、对象模型、交互主线和运行时演进目标。近期更现实的落地重点是 L1 到 L3：路线建议、部分自动执行、标准任务中的可控闭环，以及清晰的接管和证据链。

---

## 第一阶段 Specs 状态

截至 2026-04-23，任务自动驾驶第一阶段 `18` 份 specs 已完成首轮文档建模，共 `54` 份 markdown，均位于 `.kiro/specs/` 下。

已完成的 18 份 specs 覆盖六组主题：

- 产品定义：`task-autopilot-platform-positioning`、`task-autopilot-core-concepts`、`task-autopilot-levels-l1-to-l5`、`task-autopilot-success-metrics`
- 任务对象与路线：`destination-model-and-parser`、`route-planner-and-route-model`、`drive-state-and-replan-state-machine`、`fleet-organization-and-role-packaging`
- 驾驶舱交互：`autopilot-cockpit-information-architecture`、`destination-card-and-goal-summary`、`route-recommendation-and-selection`、`fleet-status-and-live-execution-view`、`takeover-panel-and-decision-points`
- Runtime 与执行引擎：`autopilot-runtime-orchestration`、`autopilot-explainability-and-telemetry`、`autopilot-recovery-and-human-takeover-governance`
- 治理与证据链：`autopilot-evidence-replay-and-trust-chain`
- 兼容与迁移：`mission-model-to-autopilot-model-mapping`

这批 specs 的意义是先稳定产品对象、语义边界、交互框架、运行时映射和治理原则。它们不是在说明所有能力已经完成代码实现，而是为后续代码落地提供清晰的分层蓝图。

---

## 后续代码落地方向

后续代码实现建议继续遵循 compatibility-first，不先做大规模底层重命名，而是通过 projection、view model 和可验证的垂直切片逐步落地。

近期更适合推进的方向包括：

- 新增 Destination / Route / Drive State / Takeover 的投影或 view model，让现有 mission、workflow、runtime、decision 能被自动驾驶界面消费。
- 改造办公室主壳和 `/tasks` 工作台的信息架构，让目的地、路线、车队、接管点和证据链成为主工作面的一等对象。
- 在运行时记录任务自动化等级、路线选择、接管原因、降级 / 重规划事件和关键证据，供 replay、audit、telemetry 消费。
- 把 Web-AIGC 节点和 adapters 逐步归类为 Fleet 角色包，而不是直接把 50+ 节点暴露给用户。
- 建立路线推荐、风险点标记、接管策略和结果复核的最小闭环，优先覆盖低风险、标准化、可审计任务。
- 用成功指标观察真实效果，包括任务送达率、接管率、重规划率、偏航率、确认次数、路线完成时长和复核通过率。

更深层的命名收敛、runtime 重构或 L4 级限定场景自动化，应在上述投影层和驾驶舱闭环稳定之后再评估。

---

## 核心界面

- `/` 是默认办公室主控台，把任务队列、3D 办公室、统一发起区和右侧上下文收在同一个桌面壳里。后续会逐步承担自动驾驶驾驶舱入口。
- `/tasks` 是全屏任务工作台，用于专注执行、监控、接管和复盘。
- `/tasks/:taskId` 保留任务深链详情页能力。
- `/replay/:missionId` 用于任务完成后的回放与证据复盘，后续会承接驾驶时间线和接管证据。
- `/debug` 是低频内部诊断与辅助工具入口。

当前产品方向仍是 mission-first：办公室主壳和 `/tasks` 是高频主工作面，回放和 debug 保留，但不与主执行流竞争。

---

## 架构

<p align="center">
  <img src="./docs/assets/diagram.png" alt="Cube Pets Office 架构概览" width="100%" />
</p>

<p align="center">
  <img src="./docs/architecture.svg" alt="Cube Pets Office 架构主图" width="100%" />
</p>

整体上，仓库分为四层：

- `client/`：React 19 + Vite 前端，包括办公室主壳、任务工作台、回放页面和 3D 场景。
- `server/`：Node.js + Express + Socket.IO 后端，负责 mission、工作流状态、事件、回放和 API。
- `services/lobster-executor/`：执行服务，支持 mock、native 和 real 三种执行方式。
- `shared/`：前端、后端和执行器共享的契约与类型定义。

运行时架构 SVG 也可直接查看：

- [docs/architecture.svg](./docs/architecture.svg)
- [docs/architecture-runtime-2026-04-21.svg](./docs/architecture-runtime-2026-04-21.svg)

---

## Web-AIGC 主线基线

`web-aigc` 是任务自动驾驶底座中的重要能力来源之一。它不直接等同于自动驾驶平台，但为路线执行、内容生产、检索问答、Office 能力、MCP、向量操作和高风险动作治理提供了节点与适配器基础。

当前基线：

- `58 / 58` 份 Web-AIGC specs 已完成，`238 / 238` 个顶层任务已收口；其中包含 `52` 个节点 specs 和 `6` 个平台 specs。
- 主服务入口已经挂载多类 Web-AIGC routes，包括搜索问答、Office / 内容生产、MCP、`transaction_flow`、`orchestration_recognition_jump`，以及向量更新 / 删除等能力。
- runtime 主线已经具备 built-in adapters、Web-AIGC extra adapters、wait / resume 控制面，以及 replay / audit observability bridge。
- 后续重点不是继续累积 spec 数量，而是把节点能力归并到 Route、Fleet、Takeover 和 Evidence 的自动驾驶语义下。

---

## 运行模式

当前仓库有三类实际运行目标：

| 环境 | 前端 | 服务端 | 执行行为 |
| ---- | ---- | ------ | -------- |
| GitHub Pages 预览 | 有 | 无 | 仅浏览器预览运行时 |
| 本地且 Docker 可用 | 有 | 有 | `real` 执行模式 |
| 本地但 Docker 不可用 | 有 | 有 | 自动回退到 `native` |

几个关键边界：

- GitHub Pages 是静态预览目标，不包含 Node 服务端，也不包含 Lobster Executor。
- `pnpm run dev:all` 会优先使用 `real`，当 Docker 不可用时自动回退到 `native`。
- 如果你显式设置 `LOBSTER_EXECUTION_MODE=mock` 或 `LOBSTER_EXECUTION_MODE=native`，会保留你的选择。

执行器更多说明见 [docs/executor/lobster-executor.md](./docs/executor/lobster-executor.md)。

---

## 快速开始

本仓库以 `pnpm` 为主。如果你的机器没有全局安装 `pnpm`，可以把下面命令替换成 `corepack pnpm`。

### 1. 只预览前端

浏览器预览流不需要 API Key。

```bash
pnpm install --frozen-lockfile
pnpm run dev:frontend
```

适合快速查看办公室主壳、3D 场景和演示体验。

### 2. 启动完整本地栈

先创建本地环境文件：

```bash
cp .env.example .env
```

PowerShell 可用：

```powershell
Copy-Item .env.example .env
```

然后补全 `.env` 里你需要的值，再启动：

```bash
pnpm run dev:all
```

常用 AI 相关环境变量：

```dotenv
LLM_API_KEY=your_api_key_here
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-5.4
LLM_WIRE_API=responses
```

### 3. 分开启动各个服务

适合你单独调试前端、后端或执行器。

```bash
pnpm run dev:server
pnpm run dev:frontend
```

显式指定执行模式启动执行器：

```bash
LOBSTER_EXECUTION_MODE=real pnpm exec tsx services/lobster-executor/src/index.ts
```

PowerShell 示例：

```powershell
$env:LOBSTER_EXECUTION_MODE='native'
pnpm exec tsx services/lobster-executor/src/index.ts
```

---

## 发布护栏

常用命令：

- `pnpm run lint`：检查发布相关文档和工作流文件的格式。
- `pnpm run typecheck`：执行 TypeScript no-emit 类型检查。
- `pnpm run test`：运行 client、server、executor 的聚合测试入口。
- `pnpm run build`：构建前端与服务端产物。
- `pnpm run test:guardrails`：运行较轻量的决策和 socket 重连回归。
- `pnpm run test:release`：执行发布前聚合检查。
- `pnpm run build:pages`：构建 GitHub Pages 产物。

对于发布敏感改动，最小建议检查集是：

```bash
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
```

---

## 仓库结构

```text
cube-pets-office/
|-- client/                    # 前端应用：办公室主壳、任务页、回放、3D 场景
|-- server/                    # 后端 API、工作流状态、事件、回放
|-- shared/                    # 共享契约与类型
|-- services/lobster-executor/ # 执行服务：mock / native / real
|-- docs/                      # 架构图、执行器说明、参考文档
|-- scripts/                   # 本地开发、构建、smoke、工具脚本
|-- data/                      # 本地数据与持久化运行文件
`-- .kiro/                     # specs、steering 与执行规划文档
```

如果你想直接从关键入口开始看，建议先读这些文件：

- [client/src/App.tsx](./client/src/App.tsx)
- [client/src/pages/Home.tsx](./client/src/pages/Home.tsx)
- [client/src/pages/tasks/TasksPage.tsx](./client/src/pages/tasks/TasksPage.tsx)
- [client/src/components/office/OfficeTaskCockpit.tsx](./client/src/components/office/OfficeTaskCockpit.tsx)
- [server/index.ts](./server/index.ts)
- [server/core/workflow-engine.ts](./server/core/workflow-engine.ts)
- [services/lobster-executor/src/index.ts](./services/lobster-executor/src/index.ts)

---

## 文档入口

- [ROADMAP.md](./ROADMAP.md)
- [CHANGELOG.md](./CHANGELOG.md)
- [docs/architecture.svg](./docs/architecture.svg)
- [docs/architecture-runtime-2026-04-21.svg](./docs/architecture-runtime-2026-04-21.svg)
- [docs/executor/lobster-executor.md](./docs/executor/lobster-executor.md)
- [.kiro/steering/task-autopilot-spec-roadmap-2026-04-23.md](./.kiro/steering/task-autopilot-spec-roadmap-2026-04-23.md)
- [.kiro/steering/execution-plan.md](./.kiro/steering/execution-plan.md)
- [.kiro/steering/spec-execution-roadmap.md](./.kiro/steering/spec-execution-roadmap.md)
- [.kiro/steering/web-aigc-58-plan-progress-summary-2026-04-22.md](./.kiro/steering/web-aigc-58-plan-progress-summary-2026-04-22.md)
- [.kiro/steering/web-aigc-runtime-mainline-checkpoints-2026-04-23.md](./.kiro/steering/web-aigc-runtime-mainline-checkpoints-2026-04-23.md)
- [.kiro/steering/web-aigc-phase-2-integration-plan.md](./.kiro/steering/web-aigc-phase-2-integration-plan.md)
- [.kiro/steering/web-aigc-next-phase-mainline-plan-2026-04-22.md](./.kiro/steering/web-aigc-next-phase-mainline-plan-2026-04-22.md)
- [.kiro/specs/task-autopilot-platform-positioning/](./.kiro/specs/task-autopilot-platform-positioning/)
- [.kiro/specs/task-autopilot-core-concepts/](./.kiro/specs/task-autopilot-core-concepts/)
- [.kiro/specs/task-autopilot-levels-l1-to-l5/](./.kiro/specs/task-autopilot-levels-l1-to-l5/)
- [.kiro/specs/](./.kiro/specs/)

`README.md` 与 `README.zh-CN.md` 保持为 GitHub 首页稳定产品文档。滚动进度、进行中的实现细节和带日期的执行记录应放在 `ROADMAP.md`、`.kiro/steering/` 和 spec 档案中。

---

## 常见问题

### 我没有安装 `pnpm`

可以直接把 `pnpm` 换成 `corepack pnpm`，例如：

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run test:release
```

### 为什么 GitHub Pages 不等于 `native` 模式？

因为 GitHub Pages 是静态部署目标，没有本地后端进程，也没有本地执行器。Pages 上展示的是浏览器预览运行时，不是宿主机进程执行。

### 现在已经是 L4 / L5 自动驾驶了吗？

不是。当前 README 使用“任务自动驾驶平台”作为产品方向和系统抽象，但不宣称已经实现开放域无人值守自动驾驶。近期落地重点是 L1 到 L3：路线建议、部分自动执行、标准任务中的可控闭环、清晰接管和完整证据链。

### 提交 PR 前最少要跑哪些命令？

至少建议跑：

```bash
pnpm run lint
pnpm run typecheck
pnpm run test
```

如果你的改动影响打包、部署或端到端运行行为，再补：

```bash
pnpm run build
pnpm run test:release
```

---

## License

MIT

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=opencroc/cube-pets-office&type=Date)](https://star-history.com/#opencroc/cube-pets-office&Date)
