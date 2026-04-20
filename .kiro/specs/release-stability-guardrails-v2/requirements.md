# 发布稳定性护栏方案 v2

## 目标

给当前收敛后的主线产品补齐最小工程护栏，确保上线前至少具备：

- 可重复构建
- 可重复测试
- 最小 CI
- 最小恢复能力
- 最小部署文档

## 当前状态（2026-04-21）

- 本 spec 当前完成度约 `89%`
- 仓库已具备统一 `lint`、`typecheck`、`test`、`build` 聚合入口，并保留 `check`、`test:client`、`test:server`、`test:executor` 等拆分命令兼容
- README 已补齐 Quick Start、环境变量样例、执行器启动方式、package manager 口径、常用命令与 FAQ
- `.github/workflows/release-guardrails.yml` 已串联最小质量门禁，并显式加入轻量 `test:guardrails`；`.github/workflows/deploy-pages.yml` 已对齐仓库声明的 `pnpm`
- 仓库已新增显式 `decision` 回归入口、`test:guardrails` 轻量关键链路入口，并为 mission socket 重连补上“重连后主动刷新任务数据 + 保留当前任务焦点 + 已加载详情 socket 运行态即时回写 + SandboxMonitor 跟随任务焦点回挂 active mission 并重拉日志历史”的最小恢复逻辑
- 当前最主要缺口收敛为：任务完整工作上下文 re-attach 的 spec 级验收闭环；`modify` 命名已对齐到当前决策模板与回归口径

## 范围

本轮覆盖：

- npm scripts
- typecheck / lint / test 入口
- GitHub Actions 最小 CI
- 关键链路最小测试
- 错误恢复与重连
- README quick start

不覆盖：

- 全量观测平台升级
- 多环境复杂发布流水线
- K8s 或云原生编排
- 一次性重写所有历史脚本体系

## 必须满足

- 仓库必须有统一的 `lint`、`typecheck`、`test`、`build` 聚合入口
- 当前仓库已具备统一聚合入口：`typecheck` 由 `check` 承接，`test` 汇总 `test:client`、`test:server`、`test:executor`，`lint` 先收口到发布护栏相关文件的格式校验
- 聚合入口优先建立在现有脚本之上，不要求一次性替换所有历史拆分命令
- 必须存在 CI 入口
- 至少覆盖任务状态机、executor 调用、decision 流
- websocket 断开必须有自动重连
- executor 超时必须 fail，不允许静默卡死
- server 重启后至少支持任务 attach 或任务状态恢复
- README 必须提供 3 步内跑起来的 quick start
- CI 与文档需要对齐仓库声明的 package manager，并说明与其他包管理器的兼容策略

## 发布门禁

至少需要通过：

1. 目标门禁：`npm run lint`
2. 目标门禁：`npm run typecheck`
3. 目标门禁：`npm run test`
4. 当前已具备的构建门禁：`npm run build`

当前收口口径：

- 推荐主口径：`pnpm run lint`、`pnpm run typecheck`、`pnpm run test`、`pnpm run build`
- 轻量关键链路回归：`pnpm run test:guardrails`
- 决策显式回归：`pnpm run test:decision`
- 发布前串联检查：`pnpm run test:release`
- 若本机没有全局 `pnpm`，允许使用 `corepack pnpm ...`
- 如需单独排查，仍可使用 `npm run check`、`npm run test:client`、`npm run test:server`、`npm run test:executor`

## 验收标准

- 新同事可以按 README 在短时间内跑起项目
- PR 具备自动化基础校验
- 关键运行链路失败时，用户不会无提示卡死
