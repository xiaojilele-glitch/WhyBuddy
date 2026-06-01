# 多 Worktree + 双仓参考开发约定（2026-03-28）

## 目标

这份约定用于支撑 `whybuddy` 在多 `git worktree` 并行开发时，稳定参考 `openclaw-feishu-progress` 的已有实现，同时避免：

- 多个 worktree 同时争抢同一批目标文件
- `whybuddy` 对兄弟仓库形成运行时依赖
- 迁移过程中把“参考代码”误当成“可直接复用的线上依赖”
- 在并行阶段过早改动 `server/index.ts`、README、环境变量文档等高冲突文件

本轮核心原则只有一句话：

`openclaw-feishu-progress` 只作为“读源仓库”，`whybuddy` 才是“唯一落地仓库”。

实际创建命令与开工检查项见 `docs/mission-worktree-bootstrap.md`。

## 仓库角色

### 目标仓库

- 仓库：`C:\Users\wangchunji\Documents\whybuddy`
- 角色：唯一主控 Brain、唯一提交目标、唯一最终运行仓库
- 本轮所有 mission / executor / feishu / tasks universe 的产出都必须落在这里

### 参考仓库

- 仓库：`C:\Users\wangchunji\Documents\openclaw-feishu-progress`
- 角色：桥接层、任务状态机、任务宇宙 UI、执行协调思想的参考源
- 默认只读，不参与本轮 `whybuddy` 的业务提交

## 路径约定

建议所有新 worktree 都与两个主仓库并列放在 `C:\Users\wangchunji\Documents\` 下，例如：

- `C:\Users\wangchunji\Documents\whybuddy-0-mission-contracts`
- `C:\Users\wangchunji\Documents\whybuddy-A-mission-core`
- `C:\Users\wangchunji\Documents\whybuddy-B-lobster-executor`

推荐编号映射：

- `0` = 契约冻结
- `A` = mission core
- `B` = lobster executor
- `C` = brain dispatch
- `D` = feishu mission bridge
- `E` = tasks universe
- `F` = mission integration

这样从任何一个 `whybuddy-*` worktree 出发，都能用固定兄弟路径访问参考仓库：

```powershell
..\openclaw-feishu-progress
```

## 总体铁律

- 只在 `whybuddy` 的主仓或其 worktree 中提交代码；`openclaw-feishu-progress` 默认不提交任何改动。
- 禁止在 `whybuddy` 代码中出现对 `..\openclaw-feishu-progress\**` 的运行时 `import`、动态加载、符号链接或包链接。
- 禁止把 `openclaw-feishu-progress` 当成本地 workspace 依赖写进 `package.json`、`tsconfig` path alias 或构建脚本。
- 允许“参考 + 迁移 + 改写”，不允许“跨仓运行时耦合”。
- 所有共享 mission 契约只允许 `Worktree 0` 改；其余 worktree 如果发现契约不够用，先回推到 `Worktree 0` 补契约，再继续实现。
- `server/index.ts`、主路由注册、`.env.example`、README 主入口说明默认只允许 `Worktree F` 收口。
- 如果某个 worktree 确实需要新增环境变量、路由或 Socket 事件，只能先在自己的文档/测试里声明需求，不直接抢改入口文件。
- 从 `openclaw-feishu-progress` 迁逻辑时，优先迁“测试思路”和“状态机边界”，其次才是实现细节。

## 参考源冻结规则

并行阶段开始前，建议先记录一次参考仓库的基线提交：

```powershell
git -C ..\openclaw-feishu-progress rev-parse HEAD
```

建议把这个 SHA 记到当轮任务说明、分支描述或交接文档里。后续如果参考仓库继续演进，不要在并行阶段中途随意切换参考基线，否则不同 worktree 读到的行为会漂移。

## 迁移方式约定

### 可以做的事

- 读取 `openclaw-feishu-progress` 源码、测试、接口命名、状态流转、UI 组织方式
- 把核心类型、状态机、路由结构、UI 交互改写后落回 `whybuddy`
- 参考它的测试案例，为 `whybuddy` 新能力补测试

### 不应该做的事

- 直接复制整仓目录到 `whybuddy`
- 直接把 Fastify / raw WebSocket 方案原封不动搬入 Cube
- 为了省事在 Cube 中写跨仓相对路径 import
- 在多个 worktree 里同时改同一批 `shared/mission/**` 契约

## Worktree 分工映射

### Worktree 0：契约冻结与并行边界

- 分支：`chore/mission-contracts`
- 参考仓库重点读取：
  - `src/types.ts`
  - `src/execution/types.ts`
  - `src/server/topic.ts`
  - `src/server/task-store.ts`
  - `src/server/task-decision.ts`
  - `src/server/routes/planets.ts`
  - `src/web/src/features/tasks/types.ts`
- 目标仓库主要产出：
  - `shared/mission/**`
  - `shared/executor/**` 或等价共享契约目录
  - `docs/mission-worktree-dual-repo.md`
  - 其他 mission 契约文档
  - `ROADMAP.md`
- 禁止改动：
  - `server/index.ts`
  - `client/src/App.tsx`
  - 具体执行器实现
  - Feishu 路由实现
- 对其他 worktree 的交付：
  - `MissionRecord` / `MissionStage` / `MissionEvent` / `MissionDecision`
  - `ExecutionPlan`
  - `ExecutorJobRequest` / `ExecutorEvent`
  - `/api/tasks`、`/api/planets`、`/api/executor/events`、Socket 事件名的冻结版接口

### Worktree A：任务域模型 + 状态机 + 持久化

- 分支：`feat/mission-core`
- 参考仓库重点读取：
  - `src/server/task-store.ts`
  - `src/server/task-store.file.ts`
  - `src/server/task-store.file.test.ts`
  - `src/server/task-decision.ts`
  - `src/server/topic.ts`
  - `src/server/croc-office.ts`
  - `src/server/routes/planets.ts`
- 目标仓库主要产出：
  - `server/tasks/**`
  - `server/db/**` 中与 mission 持久化直接相关的文件
  - `server/routes/tasks.ts`
  - `server/tests/mission-*.test.ts`
- 只读依赖：
  - `shared/mission/**`
- 禁止改动：
  - `server/index.ts`
  - `client/**`
  - `README.md`
  - `.env.example`
- 对其他 worktree 的交付：
  - 稳定的任务 REST API
  - mission 持久化结构
  - 服务重启恢复机制

### Worktree B：执行器契约 + Docker 参考执行器

- 分支：`feat/lobster-executor`
- 参考仓库重点读取：
  - `src/execution/types.ts`
  - `src/execution/coordinator.ts`
  - `src/execution/backend-manager.ts`
  - `src/execution/runtime-bootstrap.ts`
  - `src/execution/quality-gate.ts`
  - `src/execution/auth-provisioner.ts`
- 目标仓库主要产出：
  - `services/lobster-executor/**`
  - `docs/executor/**`
  - `scripts/**` 中的本地联调 / smoke 脚本
- 只读依赖：
  - `shared/mission/**`
  - `shared/executor/**`
- 禁止改动：
  - `server/index.ts`
  - `client/**`
  - `README.md`
- 对其他 worktree 的交付：
  - `/health`
  - `/api/executor/jobs`
  - 可选 `/api/executor/jobs/:id/cancel`
  - 回调到 Cube 的事件 payload 与签名规则

### Worktree C：Brain 规划 + 执行调度

- 分支：`feat/brain-dispatch`
- 参考仓库重点读取：
  - `src/server/croc-office.ts`
  - `src/server/chat-task-dispatcher.ts`
  - `src/agents/task-router.ts`
  - `src/execution/coordinator.ts`
  - `src/execution/types.ts`
- 目标仓库主要产出：
  - `server/core/mission-orchestrator.ts`
  - `server/core/executor-client.ts`
  - `server/core/execution-plan-builder.ts`
  - `server/core/**` 中与真实执行 Brain 相关的新增文件
- 只读依赖：
  - `shared/mission/**`
  - A 产出的任务 store / REST 契约
  - B 产出的执行器 HTTP 契约
- 禁止改动：
  - `server/index.ts`
  - `client/**`
  - `server/routes/feishu.ts`
  - `README.md`
- 对其他 worktree 的交付：
  - 结构化 `ExecutionPlan`
  - `dispatch / waiting / fail-fast` 行为
  - Executor 不可达时的明确错误语义

### Worktree D：Feishu 入口 + ACK / Relay / Progress Bridge

- 分支：`feat/feishu-mission-bridge`
- 参考仓库重点读取：
  - `src/server/feishu-bridge.ts`
  - `src/server/feishu-relay.ts`
  - `src/server/feishu-ingress.ts`
  - `src/server/feishu-delivery.ts`
  - `src/server/feishu-task-start.ts`
  - `src/server/relay-auth.ts`
  - `src/server/feishu-webhook-security.ts`
  - `src/server/feishu-webhook-dedup-store.ts`
  - 对应 `*.test.ts`
- 目标仓库主要产出：
  - `server/feishu/**`
  - `server/routes/feishu.ts`
  - `server/tests/feishu-*.test.ts`
  - 如需补充说明，写入 `docs/feishu/**`
- 只读依赖：
  - `shared/mission/**`
  - A 产出的任务查询 / 决策接口
- 禁止改动：
  - `server/index.ts`
  - `client/**`
  - `README.md`
  - `.env.example`
- 对其他 worktree 的交付：
  - 3 秒内 ACK
  - progress / waiting / complete / failed 回传格式
  - relay 鉴权、去重、重放保护测试

说明：虽然 roadmap 提到 D 会触达 `.env.example` 与 README，但为了减少并行冲突，这两个文件的最终落地由 `Worktree F` 统一收口。D 只需要把新增环境变量和配置说明整理到自己的文档或测试说明中。

### Worktree E：任务宇宙 UI + 3D 内部视图

- 分支：`feat/tasks-universe`
- 参考仓库重点读取：
  - `src/web/src/pages/tasks/page.tsx`
  - `src/web/src/pages/universe/**`
  - `src/web/src/features/tasks/**`
  - `src/web/src/features/tasks/universe/**`
  - `src/web/src/features/tasks/interior/**`
  - `src/server/routes/planets.ts`
- 目标仓库主要产出：
  - `client/src/pages/tasks/**`
  - `client/src/components/tasks/**`
  - `client/src/lib/tasks-store.ts`
  - 与任务宇宙 UI 直接相关的样式、hooks、Socket 订阅封装
- 只读依赖：
  - `shared/mission/**`
  - A 产出的 `/api/tasks`
  - A 或 F 暴露的 `/api/planets`
- 禁止改动：
  - `client/src/App.tsx`
  - `server/index.ts`
  - `shared/mission/**`
  - `README.md`
- 对其他 worktree 的交付：
  - `/tasks` 页所需组件树
  - 任务详情页的决策入口
  - 任务实时刷新所需的前端 store 和 Socket 消费逻辑

说明：为了减少冲突，E 负责“页面与组件实现”，不负责最终路由挂载；路由接入由 `Worktree F` 在总集成阶段统一处理。

### Worktree F：整合收口 + 兼容路由 + 验证与部署

- 分支：`feat/mission-integration`
- 参考仓库重点读取：
  - `src/server/index.ts`
  - `src/server/feishu-smoke.ts`
  - `docs/feishu-auth-deployment.md`
  - `src/server/routes/**`
  - `src/web/src/app/routes.tsx`
- 目标仓库主要产出：
  - `server/index.ts`
  - 主路由注册和主服务启动串联
  - `client/src/App.tsx` 或等价路由挂载入口
  - `.env.example`
  - `README.md`
  - 总集成 smoke 脚本与集成测试
- 只读依赖：
  - A / B / C / D / E 全部已合并能力
- 禁止改动：
  - 已冻结的 `shared/mission/**` 契约，除非明确回滚到 `Worktree 0`
- 对主分支的最终交付：
  - 新老链路共存
  - 本地和服务器可跑通的 Docker 闭环
  - 文档、环境变量、测试、部署说明统一收口

## 共享文件所有权

为了让并行开发可控，本轮按以下规则执行：

- `shared/mission/**`、`shared/executor/**`：`Worktree 0` 独占
- `server/tasks/**`、`server/routes/tasks.ts`：`Worktree A` 独占
- `services/lobster-executor/**`：`Worktree B` 独占
- `server/core/mission-*`、`server/core/executor-*`：`Worktree C` 独占
- `server/feishu/**`、`server/routes/feishu.ts`：`Worktree D` 独占
- `client/src/pages/tasks/**`、`client/src/components/tasks/**`、`client/src/lib/tasks-store.ts`：`Worktree E` 独占
- `server/index.ts`、`client/src/App.tsx`、`.env.example`、`README.md`：`Worktree F` 独占

如果确实需要跨边界改文件，先暂停并同步，不要直接在多个 worktree 里撞同一文件。

## 交接规则

每个 worktree 合并前，至少要给 `Worktree F` 留下四类可集成信息：

- 新增目录与入口文件清单
- 新增环境变量 / 路由 / Socket 事件清单
- 最小 smoke 步骤
- 仍未解决的兼容性风险

建议这些信息直接写进对应 worktree 的合并说明，或补充到 `docs/` 下的交接文档中。

## 推荐执行顺序

1. 先完成 `Worktree 0`，冻结共享契约和目录边界。
2. 然后并行推进 `Worktree A / B / C / D / E`。
3. 最后由 `Worktree F` 统一接入主入口、路由、文档和 smoke。

## 最后一条原则

如果某段逻辑在 `openclaw-feishu-progress` 里“能跑”，但和 `whybuddy` 当前的 Express、Socket.IO、3D 页面结构、动态组织主线不一致，那么优先“适配 Cube”，而不是“保留 OpenClaw 原样”。
