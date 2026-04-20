# 发布稳定性护栏方案 v2 任务拆解

## 当前状态快照（2026-04-20，已按仓库脚本、恢复链路与 CI 现状复核）

- 总体状态：进行中，约 89%
- 已有落地：
  - `package.json` 已提供统一 `lint`、`typecheck`、`test`、`build` 与 `test:release` 聚合入口，并补充 `test:guardrails` / `test:decision` / `test:socket-reconnect`
  - `.github/workflows/release-guardrails.yml` 已提供最小 GitHub Actions，并显式串联 `test:guardrails`；`.github/workflows/deploy-pages.yml` 已对齐 `pnpm`
  - README 已补齐 Quick Start、环境变量样例、执行器单独启动方式、package manager 口径、FAQ 与常用命令
  - 恢复能力已有基础：浏览器侧恢复流程、`MissionRuntime.recoverInterruptedMissions(...)`、socket 重连后主动任务刷新、当前任务焦点持久化回挂、当前内存焦点失效时回退到持久化焦点、已加载详情的 socket 运行态即时回写、SandboxMonitor 跟随恢复后的任务焦点重新挂回 active mission 并请求日志历史，以及 `mission-restart-smoke.mjs`
  - 关键链路测试已有一定覆盖：mission routes / operator actions / executor smoke / mission integration smoke / restart recovery / explicit decision regression / socket reconnect refresh recovery / stale in-memory focus fallback / sandbox active mission recovery
- 当前剩余：
  - websocket 自动重连已具备最小实现，且刷新 / 重连后可回到当前任务焦点；但“断线后完整 re-attach 到断线前任务工作上下文”的 spec 级验收闭环仍未完成
  - 本轮最小验证建议以 `pnpm run lint`、`pnpm run typecheck`、`pnpm run test:guardrails` 为主；完整 `pnpm run test` / `pnpm run build` 仍按发布前口径复跑

## Tasks

- [ ] 1. 收口仓库脚本
  - [x] 1.1 盘点现有脚本与 package manager 口径
  - [x] 1.2 统一 `lint`
  - [x] 1.3 统一 `typecheck`
  - [x] 1.4 统一 `test`
  - [x] 1.5 统一 `build`
  - [x] 1.6 保留历史拆分命令兼容性，并通过聚合入口对外收口

- [ ] 2. 建立最小 CI
  - [x] 2.1 新增 GitHub Actions
  - [x] 2.2 按仓库声明的 package manager 串联 install / lint / typecheck / test / build

- [ ] 3. 补齐关键链路测试
  - [x] 3.1 任务状态机测试
  - [x] 3.2 executor 成功 / 超时 / 失败测试
  - [x] 3.3 decision approve / reject / modify 测试

- [ ] 4. 补齐错误恢复
  - [x] 4.1 websocket 自动重连
  - [x] 4.2 executor 超时 fail
  - [ ] 4.3 任务重新 attach
    - [x] 4.3.1 刷新 / socket 重连后保留当前任务焦点
    - [x] 4.3.1a 当前内存焦点失效时回退到持久化任务焦点
    - [x] 4.3.2 已加载任务详情的 socket 运行态即时同步
    - [x] 4.3.3 SandboxMonitor 跟随恢复后的任务焦点回挂 active mission 并重拉日志历史
    - [ ] 4.3.4 完整工作上下文 re-attach
  - [x] 4.4 server 重启后最小状态恢复

- [ ] 5. 补齐 README
  - [x] 5.1 Quick Start
  - [x] 5.2 环境变量说明
  - [x] 5.3 可选 executor 启动说明
  - [x] 5.4 package manager 与命令口径说明
  - [x] 5.5 常见问题

- [ ] 6. 发布门禁回归
  - [x] 6.1 本地跑通 lint
  - [x] 6.2 本地跑通 typecheck
  - [ ] 6.3 本地跑通 test
  - [ ] 6.4 本地跑通 build
