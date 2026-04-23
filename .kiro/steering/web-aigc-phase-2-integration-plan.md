# Web-AIGC 第二阶段集成计划

更新时间：2026-04-23

## 文档目标

本文件用于把第二阶段 steering 口径固定为：

- 主线入口接线已完成，后续工作从“接线”转入“收敛”
- `58 / 58` 份 specs 与 `238 / 238` 个顶层任务维持封板，不再作为新增目标
- 下一阶段只追踪主线可验证增强，不再把 spec 增量写成阶段目标

## 当前阶段边界

第二阶段的起点已经不是“还缺哪些入口”，而是“入口接到主线后，哪些内部债务和闭环还没有收完”。

截至本版，以下内容统一视为已完成基线：

- `workflow runtime governance routes` 已落入主仓路由层
- `open-report` route 已落入主仓服务端入口
- main server 的 Web-AIGC route mounting 已完成
- RAG `vectorStore` exposure 已完成，检索底座不再依赖旁路暴露
- chat 运行时 `documentSearch` injection 已完成，chat / dialogue 内建 adapter 可直接消费
- MCP checker、tool adapter 与 mainline runtime registration 已完成接线
- vector update / delete 的 risk action wiring 已进入主线治理链

以上项目不再作为下一阶段待接线项重复追踪。

## 第二阶段真正要做的事

下一阶段统一收敛到下面五条工作线。

### 1. 类型债清理

- 清理 `server`、`shared`、route contract 与 runtime context 之间遗留的松散类型
- 优先收口 `any`、宽松 union、重复派生类型和隐式可空字段
- 先补类型边界，再扩热点行为

完成标志：

- 主线关键入口不再依赖临时类型兜底
- 共享契约能够直接服务 route、runtime 与 panel 投影三侧

### 2. runtime adapter result 类型统一

- 统一各类 runtime adapter 的结果壳，避免节点结果、治理结果、工具结果各说各话
- 明确 `success / blocked / needs_approval / failed` 等状态的统一表达
- 对齐 `output / report / audit / lineage / error` 等结果字段

完成标志：

- `workflow runtime` 内部不再维护多套结果结构
- route 层、监控层、面板层消费的是同一套结果类型

### 3. `observability / lineage` 深化

- 补齐节点执行、工具调用、向量写操作与报告链路的统一谱系字段
- 把 `open-report`、audit trail、runtime trace 和 execution record 串成一条可追踪链
- 让高风险动作和普通节点都能落到统一观测面

完成标志：

- 从一次主线执行可以回溯到 route、adapter、治理判断和报告落点
- 向量更新 / 删除不再只有风险动作记录，没有主线谱系字段

### 4. HITL / Office 面板闭环

- 统一 HITL 决策、恢复执行、状态刷新与 Office 面板的数据来源
- 打通 `DecisionPanel / DecisionHistory / tasks-store / mission-client` 与主线 runtime 投影
- 让 Office、监控面板、任务面板看到同一套 `session / projection / report`

完成标志：

- 人工确认到恢复执行形成端到端闭环
- Office 面板不再依赖与主线不同口径的临时字段

### 5. `tools-and-agents` 治理字段统一

- 对齐 `a2a / auto-agent / internal_api / guest-agents / skills / mcp` 的治理字段
- 统一 `actor`、`source`、`policy`、`approval`、`timeout`、`audit`、`lineage` 等字段命名
- 避免同一类工具调用在不同入口产生不同治理元数据

完成标志：

- 工具与代理入口的治理字段可以并排对账
- checker、tool adapter、route 和 runtime 不再维护各自私有字段口径

## 执行顺序

建议按 `类型债清理 -> 结果类型统一 -> observability / lineage -> HITL / Office 闭环 -> tools-and-agents 治理字段统一` 推进。

执行原则如下：

- 以 `main` 为唯一主线，不再把长期 worktree 作为推进前提
- 先改共享契约和类型边界，再进入热点路由与面板
- 每一批必须留下可复核结果：实现、定向验证、中文 steering 更新

## 非目标

下面这些内容不再写进第二阶段目标：

- 继续新增多少份 spec
- 继续勾选多少 checklist
- 继续为入口挂载单独开一轮接线工作

## 验收口径

第二阶段下一批工作是否完成，统一按下面标准判断：

- 主线类型与结果结构是否明显收敛
- `observability / lineage` 是否能覆盖节点、工具、向量写路径和 `open-report`
- HITL / Office 是否形成真实闭环，而不是只有服务端路由可用
- `tools-and-agents` 的治理字段是否完成统一

## 结论

第二阶段已经跨过“把入口接上主线”的阶段，进入“把主线内部口径收紧”的阶段。

后续 steering 统一记录这五条工作线的收口进度，不再使用“补 spec 进度”作为主线表述。
