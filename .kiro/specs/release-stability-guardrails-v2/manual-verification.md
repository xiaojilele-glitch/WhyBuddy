# 发布稳定性护栏方案 v2 手工验证

## 当前验证口径（2026-04-21）

- 仓库主口径使用 `pnpm`；若本机没有全局 `pnpm`，可逐条替换为 `corepack pnpm`
- 统一 `lint / typecheck / test / build` 聚合入口已落地，本轮手工验证按统一入口优先
- 当前发布前串联检查入口是 `pnpm run test:release`

## 1. 新人启动验证

1. 按 README 执行
2. 验证 3 步内可跑起前端与服务
3. 验证主要页面可访问

## 2. 构建验证

1. 运行 `pnpm run lint`
2. 运行 `pnpm run typecheck`
3. 运行 `pnpm run test`
4. 运行 `pnpm run build`
5. 如需发布前串联检查，再运行 `pnpm run test:release`
6. 如需单独排查，可补跑 `pnpm run test:client`、`pnpm run test:server`、`pnpm run test:executor`

## 3. 关键链路验证

1. 发起任务
2. 观察 executor 正常执行
3. 触发 decision
4. 完成任务并查看结果
5. 如需轻量回归 decision + socket 重连恢复，可运行 `pnpm run test:guardrails`
6. 如需显式回归 approve / reject / modify，可运行 `pnpm run test:decision`
7. 如需脚本化验证整条 mission 链路，可运行 `pnpm run smoke:mission`

## 4. 错误恢复验证

1. 人为断开 websocket
2. 验证页面至少能给出恢复提示或重新建立连接，并在重连后主动刷新任务数据、保留当前任务焦点、回写已加载详情的 socket 运行态；若当前链路只能部分恢复，应明确记录缺口
3. 人为制造 executor 超时
4. 验证任务进入失败或可恢复状态，而不是无声卡死
5. 如需脚本化验证，可运行 `pnpm run smoke:executor`

## 5. 任务恢复验证

1. 执行中刷新页面或重启服务
2. 验证页面能重新 attach 当前任务或恢复足够上下文；当前已知最小保证已提升为“刷新 / socket 重连后恢复当前任务焦点、当前内存焦点失效时回退到持久化焦点、同步已加载详情的 socket 运行态，并让 SandboxMonitor 跟随回挂 active mission 后重拉日志历史”，完整工作上下文 re-attach 仍需继续补齐
3. 如需脚本化验证，可运行 `pnpm run smoke:restart`
