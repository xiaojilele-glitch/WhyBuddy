<p align="center">
  <img src="./docs/assets/banner.png" alt="Cube Pets Office 横幅" width="100%" />
</p>

<h1 align="center">Cube Pets Office</h1>

<p align="center">
  <a href="./README.md"><strong>English</strong></a> |
  <a href="./README.zh-CN.md"><strong>简体中文</strong></a>
</p>

<p align="center">
  <strong>把 AI Agent 从“聊天结果”推进为“可观察、可控制、可执行”的任务操作系统</strong><br/>
  一个面向 AI Agent 的任务操作系统，具备可见工作流、真实执行链路，以及 3D 办公室主壳。
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
  <img alt="pages" src="https://img.shields.io/badge/demo-GitHub%20Pages-0ea5e9" />
</p>

---

## 它是什么

Cube Pets Office 不是一个聊天演示页，而是一个把 AI 请求收敛为“可见执行闭环”的任务操作系统：

- 用自然语言发起 mission
- 把任务拆解成阶段和步骤
- 在真实执行环境中跑任务
- 展示日志、产物、运行证据与回放
- 在需要时暂停等待澄清或人工决策

它的目标不是只展示最终答案，而是让整条任务生命周期都可被观察和检查。

---

## 核心界面

- `/` 是默认办公室主控台，把任务队列、3D 办公室、统一发起区和右侧上下文收在同一个桌面壳里。
- `/tasks` 是全屏任务工作台，用于专注执行和监控。
- `/tasks/:taskId` 保留任务深链详情页能力。
- `/replay/:missionId` 用于任务完成后的回放与证据复盘。
- `/debug` 是低频内部诊断与辅助工具入口。

当前产品方向是 mission-first：办公室主壳和 `/tasks` 是高频主工作面，回放和 debug 保留，但不与主执行流竞争。

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

当前 `web-aigc` 已从“补 specs”转入“按主线能力收口”的阶段。为了让首页保持稳定，这里只记录已经形成的产品与工程基线：

- `58 / 58` 份 Web-AIGC specs 已完成，`238 / 238` 个顶层任务已收口；其中包含 `52` 个节点 specs 和 `6` 个平台 specs。
- 主服务入口已经挂载多类 Web-AIGC routes，包括搜索问答、Office / 内容生产、MCP、`transaction_flow`、`orchestration_recognition_jump`，以及向量更新 / 删除等能力。
- runtime 主线已经具备 built-in adapters、Web-AIGC extra adapters、wait / resume 控制面，以及 replay / audit observability bridge；内建节点覆盖对话、控制流与 HITL 基础能力，额外适配器持续承接搜索问答、Office / 内容节点和高风险动作节点。
- 后续重点不再是继续累积 spec 数量，而是围绕主线增强、治理补线、运行时归并和前端闭环持续推进。

如果你需要更具体的主线检查点、runtime 能力边界和后续计划，请继续阅读本文档下方的 steering 入口。

---

## 运行模式

当前仓库有三类实际运行目标：

| 环境                 | 前端 | 服务端 | 执行行为            |
| -------------------- | ---- | ------ | ------------------- |
| GitHub Pages 预览    | 有   | 无     | 仅浏览器预览运行时  |
| 本地且 Docker 可用   | 有   | 有     | `real` 执行模式     |
| 本地但 Docker 不可用 | 有   | 有     | 自动回退到 `native` |

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
- [.kiro/steering/execution-plan.md](./.kiro/steering/execution-plan.md)
- [.kiro/steering/spec-execution-roadmap.md](./.kiro/steering/spec-execution-roadmap.md)
- [.kiro/steering/web-aigc-58-plan-progress-summary-2026-04-22.md](./.kiro/steering/web-aigc-58-plan-progress-summary-2026-04-22.md)
- [.kiro/steering/web-aigc-runtime-mainline-checkpoints-2026-04-23.md](./.kiro/steering/web-aigc-runtime-mainline-checkpoints-2026-04-23.md)
- [.kiro/steering/web-aigc-phase-2-integration-plan.md](./.kiro/steering/web-aigc-phase-2-integration-plan.md)
- [.kiro/steering/web-aigc-next-phase-mainline-plan-2026-04-22.md](./.kiro/steering/web-aigc-next-phase-mainline-plan-2026-04-22.md)
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
