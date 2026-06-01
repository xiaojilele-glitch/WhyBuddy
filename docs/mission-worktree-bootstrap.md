# Mission Worktree 实际创建命令清单 + 开工 Checklist（2026-03-28）

## 适用范围

这份文档是 `docs/mission-worktree-dual-repo.md` 的执行版。

- 目标仓库：`C:\Users\wangchunji\Documents\whybuddy`
- 参考仓库：`C:\Users\wangchunji\Documents\openclaw-feishu-progress`
- 当前主分支：`main`

## 编号映射

- `0` = 契约冻结
- `A` = mission core
- `B` = lobster executor
- `C` = brain dispatch
- `D` = feishu mission bridge
- `E` = tasks universe
- `F` = mission integration

## 先说结论

如果你希望新建出来的所有 worktree 都带上当前已经写好的 roadmap 和协作文档，推荐先把当前主仓里的文档改动提交一次，再批量创建 worktree。

当前主仓已有未提交改动时，直接创建的新 worktree 只会基于当前 `HEAD`，不会自动带上未提交内容。

另外，`.env` 是被 `.gitignore` 忽略的本地文件，不会随着 `git worktree add` 自动出现；如果不做额外同步，很多服务端能力会因为缺环境变量而跑不起来。

## Step 0：先固化基线

推荐在主仓先执行：

```powershell
git status --short
git add ROADMAP.md docs/mission-worktree-dual-repo.md docs/mission-worktree-bootstrap.md
git commit -m "docs: add mission worktree execution plan"
```

如果你暂时不想提交，也至少先确认这件事：

- 后面新创建出来的 worktree 不会自动带上这三份文档的未提交版本

## Step 1：记录参考仓库基线

推荐把 `openclaw-feishu-progress` 的参考提交先记下来：

```powershell
git -C ..\openclaw-feishu-progress rev-parse HEAD
```

建议把输出的 SHA 记录到：

- 合并说明
- 分支描述
- 任务卡片
- 或者每个 worktree 的临时笔记

并行阶段尽量不要频繁切换参考仓库基线。

## Step 2：实际创建 worktree 的命令清单

以下命令都在 `C:\Users\wangchunji\Documents\whybuddy` 下执行。

如果你想一次性创建全部 worktree，也可以直接运行：

```powershell
.\scripts\create-mission-worktrees.ps1
```

这个脚本现在会在主仓存在 `.env` 时，自动把 `.env` 同步到每个 mission worktree。

### 2.1 创建 Worktree 0

```powershell
git worktree add -b chore/mission-contracts ..\whybuddy-0-mission-contracts main
```

### 2.2 创建 Worktree A

```powershell
git worktree add -b feat/mission-core ..\whybuddy-A-mission-core main
```

### 2.3 创建 Worktree B

```powershell
git worktree add -b feat/lobster-executor ..\whybuddy-B-lobster-executor main
```

### 2.4 创建 Worktree C

```powershell
git worktree add -b feat/brain-dispatch ..\whybuddy-C-brain-dispatch main
```

### 2.5 创建 Worktree D

```powershell
git worktree add -b feat/feishu-mission-bridge ..\whybuddy-D-feishu-mission-bridge main
```

### 2.6 创建 Worktree E

```powershell
git worktree add -b feat/tasks-universe ..\whybuddy-E-tasks-universe main
```

### 2.7 创建 Worktree F

```powershell
git worktree add -b feat/mission-integration ..\whybuddy-F-mission-integration main
```

## Step 3：创建后核对命令

```powershell
git worktree list
```

预期至少能看到这些目录：

- `C:\Users\wangchunji\Documents\whybuddy`
- `C:\Users\wangchunji\Documents\whybuddy-0-mission-contracts`
- `C:\Users\wangchunji\Documents\whybuddy-A-mission-core`
- `C:\Users\wangchunji\Documents\whybuddy-B-lobster-executor`
- `C:\Users\wangchunji\Documents\whybuddy-C-brain-dispatch`
- `C:\Users\wangchunji\Documents\whybuddy-D-feishu-mission-bridge`
- `C:\Users\wangchunji\Documents\whybuddy-E-tasks-universe`
- `C:\Users\wangchunji\Documents\whybuddy-F-mission-integration`

同时建议核对每个 worktree 是否已有 `.env`：

```powershell
$targets = '..\whybuddy-0-mission-contracts','..\whybuddy-A-mission-core','..\whybuddy-B-lobster-executor','..\whybuddy-C-brain-dispatch','..\whybuddy-D-feishu-mission-bridge','..\whybuddy-E-tasks-universe','..\whybuddy-F-mission-integration'
foreach ($target in $targets) { Write-Output \"$target`t$(Test-Path (Join-Path $target '.env'))\" }
```

如果是旧 worktree，或者你后来修改了主仓 `.env`，可以重新同步：

```powershell
.\scripts\sync-mission-worktree-env.ps1
```

如果想强制覆盖各 worktree 当前已有的 `.env`：

```powershell
.\scripts\sync-mission-worktree-env.ps1 -Overwrite
```

你也可以逐个检查分支是否正确：

```powershell
git -C ..\whybuddy-0-mission-contracts branch --show-current
git -C ..\whybuddy-A-mission-core branch --show-current
git -C ..\whybuddy-B-lobster-executor branch --show-current
git -C ..\whybuddy-C-brain-dispatch branch --show-current
git -C ..\whybuddy-D-feishu-mission-bridge branch --show-current
git -C ..\whybuddy-E-tasks-universe branch --show-current
git -C ..\whybuddy-F-mission-integration branch --show-current
```

## Step 4：每个 worktree 通用开工 Checklist

每个 worktree 开工前都先做这几件事：

- [ ] 执行 `git branch --show-current`，确认自己在正确分支
- [ ] 执行 `git status --short`，确认当前 worktree 干净
- [ ] 记录 `openclaw-feishu-progress` 当前参考 SHA
- [ ] 重新读一遍 `docs/mission-worktree-dual-repo.md`
- [ ] 明确自己的“只写目录”和“禁止改动文件”
- [ ] 确认自己不直接写跨仓库运行时依赖
- [ ] 开工前先把需要参考的 `openclaw-feishu-progress` 源目录列出来
- [ ] 如果要新增共享契约字段，先回到 `Worktree 0` 处理，不要自己私改 `shared/mission/**`

## Worktree 0 开工 Checklist

- [ ] 在 `..\whybuddy-0-mission-contracts` 中确认当前分支为 `chore/mission-contracts`
- [ ] 阅读 `..\openclaw-feishu-progress\src\types.ts`
- [ ] 阅读 `..\openclaw-feishu-progress\src\execution\types.ts`
- [ ] 阅读 `..\openclaw-feishu-progress\src\server\topic.ts`
- [ ] 阅读 `..\openclaw-feishu-progress\src\server\task-store.ts`
- [ ] 阅读 `..\openclaw-feishu-progress\src\server\task-decision.ts`
- [ ] 阅读 `..\openclaw-feishu-progress\src\server\routes\planets.ts`
- [ ] 冻结 `MissionRecord`、`MissionStage`、`MissionEvent`、`MissionDecision`
- [ ] 冻结 `ExecutionPlan`、`ExecutorJobRequest`、`ExecutorEvent`
- [ ] 冻结 `/api/tasks`、`/api/planets`、`/api/executor/events` 契约
- [ ] 明确 Socket 事件名
- [ ] 明确目录所有权
- [ ] 禁止顺手改 `server/index.ts`、`client/src/App.tsx`
- [ ] 输出“契约已冻结”说明后，再允许 A/B/C/D/E 开工

## Worktree A 开工 Checklist

- [ ] 在 `..\whybuddy-A-mission-core` 中确认当前分支为 `feat/mission-core`
- [ ] 先拉取 `Worktree 0` 的最新契约
- [ ] 阅读 `..\openclaw-feishu-progress\src\server\task-store.ts`
- [ ] 阅读 `..\openclaw-feishu-progress\src\server\task-store.file.ts`
- [ ] 阅读 `..\openclaw-feishu-progress\src\server\task-decision.ts`
- [ ] 阅读 `..\openclaw-feishu-progress\src\server\topic.ts`
- [ ] 阅读 `..\openclaw-feishu-progress\src\server\croc-office.ts`
- [ ] 只写 `server/tasks/**`、`server/routes/tasks.ts`、必要的 `server/db/**`
- [ ] 先把状态机和持久化打通，再做 API 补全
- [ ] 先补恢复逻辑，再补事件查询
- [ ] 禁止改 `client/**`、`README.md`、`.env.example`、`server/index.ts`
- [ ] 提交前至少保证 `GET /api/tasks`、`GET /api/tasks/:id` 稳定

## Worktree B 开工 Checklist

- [ ] 在 `..\whybuddy-B-lobster-executor` 中确认当前分支为 `feat/lobster-executor`
- [ ] 先拉取 `Worktree 0` 的最新契约
- [ ] 阅读 `..\openclaw-feishu-progress\src\execution\types.ts`
- [ ] 阅读 `..\openclaw-feishu-progress\src\execution\coordinator.ts`
- [ ] 阅读 `..\openclaw-feishu-progress\src\execution\backend-manager.ts`
- [ ] 阅读 `..\openclaw-feishu-progress\src\execution\runtime-bootstrap.ts`
- [ ] 只写 `services/lobster-executor/**`、`docs/executor/**`、相关 smoke 脚本
- [ ] 先完成 `/health` 和 `/api/executor/jobs`
- [ ] 再补 Docker 容器生命周期、日志采集、工件挂载
- [ ] 再补回调签名、时间戳校验
- [ ] 禁止改 `client/**`、`server/index.ts`、README 主文档
- [ ] 提交前至少跑通一个 success job 和一个 failed job

## Worktree C 开工 Checklist

- [ ] 在 `..\whybuddy-C-brain-dispatch` 中确认当前分支为 `feat/brain-dispatch`
- [ ] 先拉取 `Worktree 0` 的最新契约
- [ ] 阅读 `..\openclaw-feishu-progress\src\server\croc-office.ts`
- [ ] 阅读 `..\openclaw-feishu-progress\src\server\chat-task-dispatcher.ts`
- [ ] 阅读 `..\openclaw-feishu-progress\src\agents\task-router.ts`
- [ ] 阅读 `..\openclaw-feishu-progress\src\execution\coordinator.ts`
- [ ] 只写 `server/core/mission-orchestrator.ts`、`server/core/executor-client.ts`、计划构建器相关文件
- [ ] 不要直接改写 `server/core/workflow-engine.ts` 主链
- [ ] 先把 `understand -> plan` 产出结构化 `ExecutionPlan`
- [ ] 再补 `dispatch`
- [ ] 再补 `waiting for decision`
- [ ] 执行器不可达时必须 fail-fast
- [ ] 禁止改 `client/**`、`server/routes/feishu.ts`、`server/index.ts`

## Worktree D 开工 Checklist

- [ ] 在 `..\whybuddy-D-feishu-mission-bridge` 中确认当前分支为 `feat/feishu-mission-bridge`
- [ ] 先拉取 `Worktree 0` 和 A 的最新接口
- [ ] 阅读 `..\openclaw-feishu-progress\src\server\feishu-bridge.ts`
- [ ] 阅读 `..\openclaw-feishu-progress\src\server\feishu-relay.ts`
- [ ] 阅读 `..\openclaw-feishu-progress\src\server\feishu-ingress.ts`
- [ ] 阅读 `..\openclaw-feishu-progress\src\server\feishu-delivery.ts`
- [ ] 阅读 `..\openclaw-feishu-progress\src\server\feishu-task-start.ts`
- [ ] 阅读 `..\openclaw-feishu-progress\src\server\relay-auth.ts`
- [ ] 只写 `server/feishu/**`、`server/routes/feishu.ts`、相关测试
- [ ] 先打通 ACK
- [ ] 再打通 progress / waiting / done / failed
- [ ] 再补 dedup、重放保护、签名校验
- [ ] 暂时不要直接改 `.env.example`、README，由 F 统一收口
- [ ] 提交前保证复杂请求 3 秒内 ACK

## Worktree E 开工 Checklist

- [ ] 在 `..\whybuddy-E-tasks-universe` 中确认当前分支为 `feat/tasks-universe`
- [ ] 先拉取 `Worktree 0` 和 A 的最新接口
- [ ] 阅读 `..\openclaw-feishu-progress\src\web\src\pages\tasks\page.tsx`
- [ ] 阅读 `..\openclaw-feishu-progress\src\web\src\pages\universe\**`
- [ ] 阅读 `..\openclaw-feishu-progress\src\web\src\features\tasks\**`
- [ ] 只写 `client/src/pages/tasks/**`、`client/src/components/tasks/**`、`client/src/lib/tasks-store.ts`
- [ ] 先完成任务列表和任务详情
- [ ] 再补时间线、决策入口、planet interior
- [ ] 再补实例信息、日志摘要、工件链接、失败原因
- [ ] 不抢改 `client/src/App.tsx` 主路由，由 F 接入
- [ ] 禁止改 `shared/mission/**`、`server/index.ts`
- [ ] 提交前保证页面不刷新即可看到状态变化

## Worktree F 开工 Checklist

- [ ] 在 `..\whybuddy-F-mission-integration` 中确认当前分支为 `feat/mission-integration`
- [ ] 不要最先开工，必须等待 A/B/C/D/E 主体完成
- [ ] 合并或 rebase A/B/C/D/E 的最新结果
- [ ] 只在这个 worktree 中改 `server/index.ts`、主路由注册、`.env.example`、README、总集成 smoke
- [ ] 接入 mission Socket 事件，同时保留旧 workflow 事件
- [ ] 接入 `/tasks` 页面路由
- [ ] 串联 Docker 执行器回调链路
- [ ] 串联 Feishu relay -> ACK -> progress -> done / failed
- [ ] 补本地 smoke
- [ ] 补服务器 smoke
- [ ] 补服务重启恢复 smoke
- [ ] 收口所有文档和环境变量说明

## 推荐日常同步命令

每个 worktree 开工前：

```powershell
git fetch origin
git status --short
```

如果 `Worktree 0` 已更新契约，其他 worktree 在自己的目录执行：

```powershell
git merge chore/mission-contracts
```

如果 A/B/C/D/E 有新的依赖能力，`Worktree F` 在自己的目录执行：

```powershell
git merge feat/mission-core
git merge feat/lobster-executor
git merge feat/brain-dispatch
git merge feat/feishu-mission-bridge
git merge feat/tasks-universe
```

## 可选的收尾命令

功能都合并回 `main` 后，可在主仓执行：

```powershell
git worktree list
git worktree remove ..\whybuddy-0-mission-contracts
git worktree remove ..\whybuddy-A-mission-core
git worktree remove ..\whybuddy-B-lobster-executor
git worktree remove ..\whybuddy-C-brain-dispatch
git worktree remove ..\whybuddy-D-feishu-mission-bridge
git worktree remove ..\whybuddy-E-tasks-universe
git worktree remove ..\whybuddy-F-mission-integration
```

确认目录都移除后，再按需删除本地分支：

```powershell
git branch -d chore/mission-contracts
git branch -d feat/mission-core
git branch -d feat/lobster-executor
git branch -d feat/brain-dispatch
git branch -d feat/feishu-mission-bridge
git branch -d feat/tasks-universe
git branch -d feat/mission-integration
```
