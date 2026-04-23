# Web-AIGC 主线增强批次纪要（2026-04-23）

## 范围

本纪要记录的是“主线入口接线收口完成后的下一批工作”，不是新一轮 spec 补写说明。

本批只确认两件事：

- 哪些入口级能力已经正式进入主线基线
- 下一批主线增强应该收哪几类内部债务

## 本批已收口

以下内容在本批之后统一视为已完成基线：

- `workflow runtime governance routes` 已接入主仓路由层
- `open-report` route 已接入主仓服务端入口
- main server 的 Web-AIGC route mounting 已完成
- RAG `vectorStore` exposure 已完成
- chat 运行时 `documentSearch` injection 已完成
- MCP checker、tool adapter 与 mainline runtime registration 已完成
- vector update / delete 的 risk action wiring 已完成

这意味着主线当前已经具备入口、治理、检索、MCP 和向量写路径的最小接线闭环。

## 下一批定义

下一批不再以补 spec 增量为口径，统一收敛到下面五项。

### 1. 类型债清理

目标：

- 清理 `server`、`shared`、runtime context、route contract 之间的松散类型
- 优先移除热点路径上的 `any`、宽 union、重复派生类型和隐式可空字段

收口信号：

- 主线关键入口的类型边界稳定
- 共享契约不再需要多份临时补丁类型兜底

### 2. runtime adapter result 类型统一

目标：

- 统一节点执行、工具执行、治理判断的结果壳
- 对齐 `success / blocked / needs_approval / failed` 等状态表达
- 对齐 `output / error / report / audit / lineage` 等结果字段

收口信号：

- route、runtime、监控、面板消费同一套结果类型
- checker、tool adapter、runtime adapter 不再输出各自私有结果结构

### 3. `observability / lineage` 深化

目标：

- 打通 execution record、runtime trace、audit trail 与 `open-report`
- 给节点执行、工具调用、向量更新 / 删除补齐统一谱系字段
- 让治理动作和业务动作共用同一套追踪链

收口信号：

- 任一条主线执行都能回溯到 route、adapter、checker 和 report
- 向量写路径进入主线观测面

### 4. HITL / Office 面板闭环

目标：

- 统一 HITL 决策、恢复执行、状态刷新和 Office 面板来源
- 对齐 `DecisionPanel / DecisionHistory / tasks-store / mission-client`
- 让 Office、监控面板、任务面板共用主线 `session / projection / report`

收口信号：

- 人工确认、回写、恢复执行形成端到端闭环
- Office 面板不再依赖与主线不一致的临时字段

### 5. `tools-and-agents` 治理字段统一

目标：

- 对账 `a2a / auto-agent / internal_api / guest-agents / skills / mcp`
- 统一 `actor`、`source`、`approval`、`policy`、`timeout`、`audit`、`lineage` 命名
- 让不同入口的工具调用在治理字段上可以直接并排比较

收口信号：

- 工具与代理入口的治理元数据可直接对账
- checker、tool adapter、route、runtime 的治理命名统一

## 推荐顺序

建议按下面顺序推进下一批：

1. 类型债清理。
2. runtime adapter result 类型统一。
3. `observability / lineage` 深化。
4. HITL / Office 面板闭环。
5. `tools-and-agents` 治理字段统一。

## 明确不做

下一批不再把下面内容当作目标：

- 继续追加 `web-aigc` spec 条目
- 再做一轮主线入口挂载
- 用新增 worktree 数量表示推进进度

## 结论

本批已经把主线入口接线收口到位。下一批的任务不是继续扩入口，而是把主线内部的类型、结果、观测、面板和治理字段收成同一套口径。
