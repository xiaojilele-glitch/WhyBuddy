# Web-AIGC 下一阶段主线计划

更新时间：2026-04-23

## 主线状态声明

当前主线已经完成入口级接线，下一阶段直接进入主线收敛。

以下内容统一作为已完成基线，不再列为下一阶段待办：

- `58 / 58` 份 `web-aigc` specs 已全部完成
- `238 / 238` 个顶层任务已全部勾选完成
- `workflow runtime governance routes` 已进入主仓路由层
- `open-report` route 已进入主仓服务端入口
- main server 的 Web-AIGC route mounting 已完成
- RAG `vectorStore` exposure 已完成
- chat 运行时 `documentSearch` injection 已完成
- MCP checker、tool adapter 与 mainline runtime registration 已完成
- vector update / delete 的 risk action wiring 已完成

这意味着下一阶段不再解决“入口有没有接上”，而是解决“主线内部口径有没有收拢”。

## 下一阶段优先级

### P0：类型边界与结果类型收敛

- 清理 `server / shared / runtime / route contract` 之间的类型债
- 统一 runtime adapter result 的状态、输出、错误和治理字段
- 优先消除 `any`、宽松 union 和重复结果结构

本阶段完成信号：

- 主线关键入口的类型边界稳定
- route、runtime、监控、面板看到的是同一套结果类型

### P1：`observability / lineage` 深化

- 打通 execution record、audit trail、runtime trace 与 `open-report`
- 让节点执行、工具调用、向量更新 / 删除拥有统一谱系字段
- 把报告、治理判断与执行轨迹串成一条可追溯链

本阶段完成信号：

- 任一条主线执行都能回溯到 route、adapter、checker、report
- 向量写路径不再脱离主线观测面

### P2：HITL / Office 面板闭环

- 统一 HITL 决策、恢复执行、状态刷新与 Office 面板的数据来源
- 对齐 `DecisionPanel / DecisionHistory / tasks-store / mission-client`
- 让 Office、监控面板、任务面板共用一套 `session / projection / report` 语义

本阶段完成信号：

- 人工确认、回写、恢复执行形成完整闭环
- Office 面板不再依赖临时兼容字段

### P3：`tools-and-agents` 治理字段统一

- 对账 `a2a / auto-agent / internal_api / guest-agents / skills / mcp`
- 统一 `actor`、`source`、`approval`、`policy`、`timeout`、`audit`、`lineage` 字段
- 让 checker、tool adapter、route 与 runtime 使用同一套治理命名

本阶段完成信号：

- 工具与代理链路可以跨入口并排对账
- 不再因为入口不同而产生不同治理字段

## 推荐批次

建议按下面顺序推进：

1. 先做类型债清理。
2. 再统一 runtime adapter result。
3. 随后补深 `observability / lineage`。
4. 然后完成 HITL / Office 面板闭环。
5. 最后统一 `tools-and-agents` 治理字段。

## 执行约束

- 以 `main` 为唯一集成主线
- 不再把 spec 增量写入计划目标
- 不再把新一轮 route mounting 当作下一阶段核心成果
- 每一批必须留下可复核产物：实现、定向验证、中文 steering 更新

## 非目标

下一阶段明确不包含下面内容：

- 再新增多少份 spec
- 再新增多少份 checklist
- 再开多少 worktree 来承载入口接线

## 验收口径

下一阶段是否推进成功，统一按以下标准判断：

- 类型债是否明显下降
- runtime adapter result 是否完成统一
- `observability / lineage` 是否能覆盖节点、工具与向量写路径
- HITL / Office 是否形成真实闭环
- `tools-and-agents` 是否完成治理字段统一

## 结论

下一阶段计划的核心不是“继续补文档”，而是“把已经接上的主线能力收成同一套可维护、可观测、可闭环的内部口径”。
