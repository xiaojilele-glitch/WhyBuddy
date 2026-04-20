<p align="center">
  <img src="./banner.png" alt="Cube Pets Office banner" width="100%" />
</p>

<h1 align="center">Cube Pets Office</h1>

<p align="center">
  <strong>把 AI Agent 从“聊天结果”推进为“可观察、可控制、可执行”的任务操作系统</strong><br/>
  A task operating system for AI agents, with visible workflow, real execution, and a 3D office shell.
</p>

<p align="center">
  <a href="https://opencroc.github.io/cube-pets-office/"><strong>在线体验 Live Demo</strong></a>
</p>

<p align="center">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-111827" />
  <img alt="frontend" src="https://img.shields.io/badge/frontend-React%2019%20%2B%20Vite-2563eb" />
  <img alt="runtime" src="https://img.shields.io/badge/runtime-frontend%20%7C%20native%20%7C%20real-16a34a" />
  <img alt="3d" src="https://img.shields.io/badge/3D-Three.js-f97316" />
  <img alt="executor" src="https://img.shields.io/badge/executor-Lobster-7c3aed" />
  <img alt="i18n" src="https://img.shields.io/badge/i18n-中文%20%2F%20English-0ea5e9" />
</p>

---

## 为什么是它

Cube Pets Office 不是一个“多智能体聊天演示页”，而是一个把任务生命周期完整收口到统一界面的 AI Agent 操作系统：

- 一句话发起任务
- 自动拆解计划与组织协作
- 在真实执行环境里跑任务
- 展示日志、产物、状态与回放
- 在需要人工参与时提供决策入口

你看到的不只是最终答案，还包括任务怎么被规划、谁在执行、卡在什么地方、系统到底做了什么。

---

## 产品视角

从产品体验上看，Cube Pets Office 正在收敛成一条更清晰的主线：

- `/` 是默认任务入口，承接发起、澄清、执行追踪和控制
- `/tasks/:taskId` 保留为全屏工作台与深链详情页
- `/replay/:missionId` 承接任务完成后的回放与证据复盘
- 低频能力逐步迁到更隐藏的调试与内部入口

当前桌面端已经把办公室主壳、任务队列、`Scene3D`、右侧上下文区、统一发起入口和任务操作区收口到同一屏里，方向上更接近“任务操作系统”，而不是“多页面功能集合”。

---

## 架构总览

下面这张图更适合作为产品蓝图来理解 Cube Pets Office 的整体分层：客户端入口、应用服务层、执行层、数据层、外部能力和部署建议一眼能串起来。

<p align="center">
  <img src="./diagram.png" alt="Cube Pets Office architecture overview" width="100%" />
</p>

这张图表达的是产品与平台蓝图。当前仓库里已经落地的核心实现可以概括为：

- 前端：React 19 + Vite + Zustand + Three.js，负责办公室主壳、任务工作台、回放与可视化
- 服务端：Node.js + Express + Socket.IO，负责任务状态、工作流、事件、回放、审计与接口层
- 执行层：`services/lobster-executor`，支持 `mock`、`native`、`real` 三种执行模式
- 存储：浏览器 IndexedDB、本地 JSON，以及逐步扩展的任务、回放、知识与审计数据能力

如果你想看“当前运行时到底怎么落地”，再往下直接看运行模式和补充文档即可。

---

## 一次任务是怎么跑完的

以一句话任务为例：

```text
制定本季度用户增长策略，并给出可执行分工和落地节奏
```

系统的主路径大致会经过这些阶段：

| 阶段 | 系统动作                       | 你能看到什么                             |
| ---- | ------------------------------ | ---------------------------------------- |
| 发起 | 接收自然语言任务，创建 mission | 首页右侧发起区、任务队列出现新任务       |
| 计划 | 生成 plan / step / breakdown   | 首页中间主线区显示阶段与摘要             |
| 执行 | Worker / executor 开始实际运行 | 日志流、运行状态、当前步骤更新           |
| 决策 | 需要澄清、批准、修改时暂停等待 | 控制区出现 decision / clarification      |
| 结果 | 生成产物、截图、报告、输出物   | `Artifacts` 与结果摘要可查看             |
| 复盘 | 通过回放或详情页追踪全过程     | `/tasks/:taskId` 与 `/replay/:missionId` |

这也是整个项目的关键区别：任务不是停在“模型回复”，而是进入“规划、执行、反馈、收尾”的完整闭环。

---

## 当前运行模式

Cube Pets Office 当前支持三种执行模式：

| 模式       | 适合场景                 | 说明                               |
| ---------- | ------------------------ | ---------------------------------- |
| `frontend` | 在线演示、纯体验         | 浏览器内运行，不依赖本地 Docker    |
| `native`   | 本地开发、无 Docker 环境 | 本机进程执行，保留较真实的执行链路 |
| `real`     | 完整开发与验证           | 通过 Docker 容器执行真实任务       |

当前默认策略：

- 本地环境可连 Docker 时优先走 `real`
- 本地无 Docker 时自动回退到 `native`
- GitHub Pages 只提供浏览器前端运行时

补充文档：

- [当前运行时说明](./.kiro/steering/2026-04-15-runtime-current-state.md)
- [系统架构图](./docs/architecture.svg)

<p align="center">
  <img src="./docs/architecture.svg" alt="Cube Pets Office system architecture" width="100%" />
</p>

---

## 快速开始

仓库主口径使用 `pnpm`，与 `pnpm-lock.yaml` 和 CI 保持一致。若本机还没有全局 `pnpm` 命令，可将下文中的 `pnpm` 逐条替换为 `corepack pnpm`；现有 `npm run <script>` 仍保留脚本兼容，但依赖安装与流水线统一以 `pnpm` 为准。

### 1. 纯体验模式

不需要 API Key，直接启动前端：

```bash
pnpm install --frozen-lockfile
pnpm run dev:frontend
```

适合先看 3D 办公室、任务壳、演示数据与交互流程。

### 2. 完整开发模式

接入模型、服务端和执行器：

```bash
cp .env.example .env
pnpm run dev:all
```

最小 `.env` 参考：

```dotenv
LLM_API_KEY=你的密钥
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-5.4
LLM_WIRE_API=responses
```

### 3. 单独控制执行器

适合调试执行链路：

```bash
# 终端 1
pnpm run dev:server

# 终端 2
pnpm run dev:frontend

# 终端 3
LOBSTER_EXECUTION_MODE=mock pnpm exec tsx services/lobster-executor/src/index.ts
```

其他执行模式：

```bash
LOBSTER_EXECUTION_MODE=native pnpm exec tsx services/lobster-executor/src/index.ts
LOBSTER_EXECUTION_MODE=real pnpm exec tsx services/lobster-executor/src/index.ts
```

PowerShell 下可先执行：

```powershell
$env:LOBSTER_EXECUTION_MODE='mock'
```

---

## 发布护栏

当前发布护栏已经收口到统一入口，CI 与本地执行口径基本一致，并补了一个轻量关键链路验证入口：

- 基线门禁：`pnpm run lint`、`pnpm run typecheck`、`pnpm run test`、`pnpm run build`
- 轻量关键链路回归：`pnpm run test:guardrails`
- 发布串联检查：`pnpm run test:release`
- 决策回归入口：`pnpm run test:decision`
- Smoke 脚本：`pnpm run smoke:prod`、`pnpm run smoke:executor`、`pnpm run smoke:mission`、`pnpm run smoke:restart`
- 最小 CI：`.github/workflows/release-guardrails.yml`
- GitHub Pages 构建：`.github/workflows/deploy-pages.yml`

当前 `lint` 先收口到发布护栏相关文件的 Prettier 校验，避免在未统一历史风格基线前把整个仓库一次性拖入格式迁移。
当前 websocket 恢复口径已包含“socket 重连后主动刷新任务数据 + 恢复当前任务焦点 + 回写已加载详情的 socket 运行态”；但“完整 re-attach 到断线前任务工作上下文”的端到端闭环仍需要进一步补齐。

---

## 仓库结构

```text
cube-pets-office/
├── client/                      # 前端应用：办公室主壳、任务页、回放、3D 场景
├── server/                      # 服务端：任务状态、工作流、接口、回放、审计
├── shared/                      # 前后端共享契约与类型
├── services/lobster-executor/   # 执行器：mock / native / real
├── docs/                        # 架构图、契约与说明文档
├── data/                        # 本地数据、回放、测试数据
├── scripts/                     # 本地开发与构建脚本
└── .kiro/                       # specs、steering、执行计划
```

如果你想直接从关键实现开始看，建议先看这些文件：

- [Home.tsx](./client/src/pages/Home.tsx)
- [TasksPage.tsx](./client/src/pages/tasks/TasksPage.tsx)
- [OfficeTaskCockpit.tsx](./client/src/components/office/OfficeTaskCockpit.tsx)
- [workflow-engine.ts](./server/core/workflow-engine.ts)
- [browser-runtime.ts](./client/src/runtime/browser-runtime.ts)
- [lobster-executor](./services/lobster-executor/src/index.ts)

---

## 现在已经具备什么

当前仓库已经具备这些核心能力：

- 3D 办公室与任务状态联动
- 任务状态机、计划执行与人工决策链路
- 回放、日志、产物、任务详情等执行证据面
- `mock / native / real` 三种执行模式
- 前端浏览器运行时与服务端运行时并存
- 成本观测、审计、权限、数据血缘等平台能力
- 中英文切换与桌面优先体验收口

近期重点则集中在这几条主线：

- 办公室主壳继续收敛为唯一高频任务入口
- 首页重构为更稳定的任务操作系统四区骨架
- 运行时证据继续集中到首页主线区与底部 runtime dock
- 发布护栏、回放与 debug 面继续补齐

更细的执行计划与规格文档见：

- [`.kiro/steering/execution-plan.md`](./.kiro/steering/execution-plan.md)
- [`.kiro/specs/`](./.kiro/specs/)

---

## 常用命令

```bash
pnpm run dev:frontend    # 只启动前端
pnpm run dev:server      # 只启动服务端
pnpm run dev:all         # 启动前端 + 服务端 + 执行器
pnpm run dev:stop        # 停止本地开发进程
pnpm run lint            # 发布护栏相关文件格式校验
pnpm run typecheck       # TypeScript 类型检查聚合入口
pnpm run test            # 前端 + 服务端 + 执行器测试聚合入口
pnpm run build           # 构建前端 + 服务端
pnpm run build:pages     # 构建 GitHub Pages 产物
pnpm run preview         # 本地预览前端构建结果
pnpm run test:guardrails # 轻量关键链路回归（decision + socket 重连恢复）
pnpm run test:decision   # approve / reject / modify 决策回归
pnpm run test:client     # 前端测试
pnpm run test:server     # 服务端测试
pnpm run test:executor   # 执行器测试
pnpm run smoke:release   # 关键链路 smoke 汇总
pnpm run test:release    # 发布前总检查
```

---

## 技术栈

| 层      | 技术                                                     |
| ------- | -------------------------------------------------------- |
| 前端    | React 19、Vite、TypeScript、Zustand、Three.js、shadcn/ui |
| 服务端  | Node.js、Express、Socket.IO、TypeScript                  |
| 执行器  | Lobster Executor、Docker、Node.js                        |
| 测试    | Vitest、fast-check                                       |
| 存储    | IndexedDB、本地 JSON，以及逐步扩展的数据能力             |
| AI 接入 | OpenAI-compatible API、可扩展模型提供商                  |

---

## 文档入口

- [ROADMAP.md](./ROADMAP.md)
- [CHANGELOG.md](./CHANGELOG.md)
- [docs/](./docs/)
- [`.kiro/steering/`](./.kiro/steering/)
- [`.kiro/specs/`](./.kiro/specs/)

---

## 常见问题

### `pnpm` 命令不存在怎么办？

直接把 README 里的 `pnpm` 替换成 `corepack pnpm` 即可，例如 `corepack pnpm install --frozen-lockfile`、`corepack pnpm run test:release`。仓库的 CI 也是按这个口径执行的。

### 为什么还保留 `npm run` 兼容？

历史脚本和部分本地习惯仍在使用 `npm run <script>`。当前保留这层兼容，避免打断现有开发流；但安装依赖、锁文件、CI 缓存和文档主口径统一以 `pnpm` 为准。

### 发布前最少需要跑哪些命令？

最小门禁是 `pnpm run lint`、`pnpm run typecheck`、`pnpm run test`、`pnpm run build`。如果只想先做一次轻量 spot-check，可先运行 `pnpm run test:guardrails`；如果要做发布前串联检查，再运行 `pnpm run test:release`。

---

## 参与贡献

欢迎 PR。

提交前建议至少运行：

```bash
pnpm run lint
pnpm run typecheck
pnpm run test
```

如果当前分支存在进行中的类型基线问题，请尽量保证不新增错误，并在提交说明中标明影响范围。

---

## License

MIT

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=opencroc/cube-pets-office&type=Date)](https://star-history.com/#opencroc/cube-pets-office&Date)
