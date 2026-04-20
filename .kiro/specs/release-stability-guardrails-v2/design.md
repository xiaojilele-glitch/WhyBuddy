# 发布稳定性护栏方案 v2 设计

## 现状问题

当前项目已有较多脚本与测试，但仍存在几个明显短板：

- 入口脚本命名不够统一
- CI 护栏不稳定或不完整
- 关键主线的测试覆盖仍不足
- 运行时错误恢复不够强
- 新人启动成本偏高

## 护栏分层

## 脚本策略

本轮优先做“聚合入口补齐”，不是“历史命令全盘重写”：

- 允许保留 `test:client`、`test:server`、`test:executor` 这类拆分脚本
- 对外补齐统一的 `lint`、`typecheck`、`test`、`build`
- 若仓库当前没有完整 lint 体系，`lint` 可以先聚合已有静态检查与格式校验，不强推一轮新的重型迁移
- CI 应优先使用仓库声明的 package manager 执行统一入口

### 1. 基线层

- `lint`
- `typecheck`
- `test`
- `build`

这一层负责保证仓库具备最小工程可维护性。

### 2. 关键链路测试层

只围绕 MVP 主线补测试：

- 任务状态机
- executor 成功 / 超时 / 失败
- decision approve / reject / modify

### 3. 运行恢复层

最少要保证：

- websocket 自动重连
- executor 超时 fail
- 可重新 attach 当前任务
- server 重启后任务不会完全丢失上下文

### 4. 文档层

README 至少具备：

- quick start
- 环境变量说明
- executor 启动方式
- 常见问题

## CI 设计

推荐最小 GitHub Actions：

- checkout
- setup-node
- setup-pnpm
- install
- lint
- typecheck
- test
- build

执行口径：

- 依赖安装使用 `pnpm install --frozen-lockfile`
- CI 主门禁执行 `pnpm run lint`、`pnpm run typecheck`、`pnpm run test`、`pnpm run build`
- Pages 工作流同样对齐 `pnpm`，避免文档、锁文件与缓存策略分裂

不在本轮引入复杂矩阵，也不把 smoke 测试强行塞进每个 PR 的最小门禁。

## 代码落点

- `package.json`
- README
- GitHub Actions
- websocket / runtime 恢复逻辑
- executor 调用与超时处理
- 关键 vitest 用例

## 风险

- 不建议一口气全仓库补覆盖率
- 只需要守住主链路，不要把低频实验模块一起拖进门禁
- 若统一入口与现有拆分脚本关系不明确，后续 README、CI、本地执行口径会继续分裂
