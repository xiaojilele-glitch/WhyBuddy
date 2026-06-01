# 需求文档：Drive State 与 Replan 状态机

## 目标

定义 WhyBuddy 在“任务自动驾驶”产品叙事下的高层驾驶状态机，使系统能够把当前 mission-first、Mission Runtime、workflow runtime、replay、audit 等已有能力，统一投影为用户可理解的任务行驶状态。

本 spec 的目标包括：

- 定义 `Drive State` 的标准状态集合
- 定义 `Replan` 触发条件与重规划语义
- 定义高层状态与当前 workflow / runtime state 的映射关系
- 确保该状态机与现有 Mission Runtime、人工接管、回放与审计能力兼容

本 spec 不是要替换底层运行时状态，而是建立一层稳定的产品态状态机解释层。

## 背景

当前主仓已经具备以下能力基础：

- mission-first 的任务发起与任务工作台
- Workflow 与 Mission Runtime 驱动的任务执行
- 节点执行、等待输入、重试、终止、升级等运行时控制
- review / audit / revise / verify 等质量与治理闭环
- replay / audit / evidence 等可观察能力
- HITL、decision、人工输入恢复等人工接管链路

这些能力已经足以让系统“真正执行任务”，但对用户而言，当前底层状态的理解成本仍然较高：

- 有些状态属于任务层
- 有些状态属于实例层
- 有些状态属于节点层
- 有些状态属于治理层
- 有些状态通过 replay / audit 事件才能推断

为了让系统具备“任务自动驾驶”体验，必须在这些底层事实之上，构建一套高层驾驶状态机。

## 范围

本 spec 包含：

- 高层 `Drive State` 状态定义
- `Replan` 的定义与触发方式
- Drive State 之间的迁移条件
- 与现有 workflow / runtime / replay / audit 的映射方式
- 与 mission-first 任务主流程的兼容要求

本 spec 不包含：

- 对底层 runtime state 的彻底重命名
- 对现有 workflow engine 的推翻式重写
- 对路线推荐 UI 的完整交互设计
- 对所有节点细粒度状态的逐个建模

## 核心状态定义

系统必须至少支持以下十个高层 Drive State：

- `understanding`
- `clarifying`
- `planning`
- `fleet-forming`
- `executing`
- `reviewing`
- `blocked`
- `takeover-required`
- `replanning`
- `delivered`

这些状态用于表达用户可理解的任务推进过程，而不是取代底层工程状态。

## 需求

### 需求 1：系统必须定义统一的高层 Drive State 集合

系统必须提供一套统一的高层驾驶状态集合，作为任务自动驾驶的标准状态机。

高层状态必须覆盖：

- 任务理解中
- 信息澄清中
- 路线规划中
- 车队编组中
- 正在执行中
- 正在复核中
- 被阻塞
- 需要接管
- 正在重规划
- 已送达结果

系统不得让前端、文档、回放、审计各自维护一套不同命名的状态集合。

### 需求 2：每个 Drive State 必须有清晰语义

系统必须为每个状态定义明确语义。

最低语义要求如下：

- `understanding`
  - 系统正在解析用户目标、任务上下文、约束与成功标准
- `clarifying`
  - 系统发现缺失信息，正在发起或等待澄清
- `planning`
  - 系统正在生成推荐路线、阶段安排、执行方案或治理约束
- `fleet-forming`
  - 系统正在选择执行角色、节点组合、Agent 编组或工具装配
- `executing`
  - 系统正在运行主执行链路，产生中间产物或结果
- `reviewing`
  - 系统正在进行 review、audit、verify、revise 等质量与治理检查
- `blocked`
  - 系统当前无法自动推进，且未进入可恢复的正常执行态
- `takeover-required`
  - 系统需要用户或人工角色介入
- `replanning`
  - 系统正在因偏航、失败、上下文变化或策略调整而重新生成路线
- `delivered`
  - 系统已完成交付，并形成可查看结果

### 需求 3：系统必须定义 Drive State 的迁移条件

系统必须明确状态之间如何迁移，至少覆盖以下典型迁移：

- `understanding -> clarifying`
- `understanding -> planning`
- `clarifying -> planning`
- `planning -> fleet-forming`
- `planning -> takeover-required`
- `fleet-forming -> executing`
- `executing -> reviewing`
- `executing -> blocked`
- `executing -> takeover-required`
- `executing -> replanning`
- `reviewing -> delivered`
- `reviewing -> replanning`
- `reviewing -> takeover-required`
- `blocked -> takeover-required`
- `blocked -> replanning`
- `takeover-required -> clarifying`
- `takeover-required -> planning`
- `takeover-required -> executing`
- `replanning -> fleet-forming`
- `replanning -> executing`
- `replanning -> takeover-required`

系统必须允许存在少量实现层补充迁移，但不得偏离主状态机语义。

### 需求 4：系统必须定义 Replan 的独立语义

系统必须将 `replanning` 定义为独立高层状态，而不是简单归入失败或重试。

`Replan` 至少应覆盖以下触发场景：

- 原路线在执行中失败，且继续原路径收益过低
- review / audit 发现结果质量不达标，需要重新组织路径
- 用户新增约束、改目标、改优先级
- 工具、节点、执行器或外部依赖不可用
- 风险、成本、时延超出当前路线允许范围
- 人工接管后选择切换策略或路线

系统必须能区分：

- 普通重试
- 普通等待输入
- 真正的路线重规划

### 需求 5：系统必须兼容现有 workflow / runtime state

系统必须明确 Drive State 是高层投影，而不是底层 runtime state 的直接替代。

兼容要求：

- 不要求当前所有 workflow 实例状态立即改名
- 不要求所有节点状态立即并入 Drive State
- 允许多个底层状态共同映射为一个 Drive State
- 允许同一个 Drive State 由任务层、实例层、治理层多个信号共同推断

### 需求 6：系统必须兼容 mission-first 与 Mission Runtime

系统必须保证 Drive State 状态机能够挂接在当前 mission-first 主流程之上。

兼容要求：

- 不破坏 Mission Runtime 的运行时主干
- 不破坏当前任务创建、推进、暂停、恢复、终止、升级链路
- 允许 Mission Runtime 继续作为事实执行引擎
- Drive State 只负责高层解释与展示，不替代执行引擎

### 需求 7：系统必须兼容 replay / audit / evidence

系统必须保证 Drive State 与 Replan 能被 replay、audit、证据链路消费。

至少应满足：

- 回放可以展示历史 Drive State 变化
- 审计可以说明为什么进入 `blocked` 或 `takeover-required`
- 重规划应留下原因、前置状态、触发事件与结果摘要
- 高层状态变化不应只是前端瞬时计算，至少应可被服务端或事件层重建

### 需求 8：系统必须与人工接管链路兼容

系统必须把 `takeover-required` 作为与现有 HITL / decision 机制兼容的高层状态。

至少应覆盖以下情况：

- 等待用户补充信息
- 等待用户确认方向
- 等待权限或预算授权
- 等待人工审批
- 等待最终结果确认
- 自动执行遇到异常，需要人工接手

### 需求 9：系统必须能服务驾驶舱主视图

Drive State 状态机的定义必须能直接服务后续驾驶舱展示，包括：

- 当前状态标签
- 当前阶段说明
- 下一步预计动作
- 阻塞原因
- 接管原因
- 重规划原因
- 交付完成态说明

### 需求 10：系统必须支持分阶段落地

Drive State 与 Replan 状态机必须支持分阶段实现：

- 第一阶段：文档定义与术语统一
- 第二阶段：前端 view model 映射
- 第三阶段：服务端 projection 或事件投影
- 第四阶段：回放、审计、状态可解释性增强

系统不应要求一次性改造完所有 runtime 才能使用高层状态机。

## 实现边界复核（2026-04-25）

基于当前主仓中可直接核对的实现与测试，本 spec 在进入进一步实现前，应先明确以下边界：

- 当前已直接锚定的底层状态来源，主要集中在 mission / projection / explanation 这一层：
  - `mission.status`
  - `mission.currentStageKey`
  - `mission.waitingFor`
  - `mission.decision`
  - `mission.operatorState`
  - `mission.blocker`
  - `mission.attempt`
  - `mission.operatorActions`
  - `workflowRuntime.status`
  - `workflowRuntime.currentStage`
  - `execution.currentStepStatus`
  - `recovery.state`
  - `recovery.deviationCategory`
  - `evidence.timeline`
  - `evidence.correlation`
  - `explanation.currentState`
  - `explanation.remainingSteps`
- 当前“Drive State 主链路”已有明确设计目标，但代码层更接近“基于 mission facts 的时点投影”，而不是一套端到端、显式可回放的高层状态迁移契约。
- 当前 `replanning` 的真实信号来源，已有直接实现锚点的主要是：
  - `attempt > 1`
  - `retry / escalate` 等 operator action 带来的恢复与重规划语义
  - blocker / waiting / route replan 摘要在 projection 层的联动
- 以下 `replanning` 信号目前仍主要停留在设计语义层，不应在 tasks 中保守勾选为已闭环：
  - review 质量缺口驱动改线
  - dependency unavailable 驱动改线
  - constraint changed / user reroute 驱动改线
  - risk exceeded 驱动改线
- 当前已有最小事件字段骨架，可供 replay / audit / cockpit 消费：
  - `evidence.timeline.{id,type,label,detail,status,source,time}`
  - `evidence.correlation.{workflowId,replayId,sessionId,routeIds,runtimeEventIds,decisionIds,operatorActionIds,auditEventIds,lineageIds}`
  - `explanation.currentState.{driveState,missionStatus,currentStageKey,currentStageLabel,workflowStatus,workflowStage,routeSelectionStatus,selectedRouteId,correlationTimelineId,sources,updatedAt}`
  - `explanation.remainingSteps.{currentStepKey,currentStepLabel,mainlineSteps,pendingSteps,parallelBranchCount,replanChangeSummary}`
- 但当前尚不存在统一的高层状态切换事件契约，例如：
  - `previousDriveState`
  - `nextDriveState`
  - `triggerType`
  - `triggerReason`
  - 单条事件内完整携带的 transition-level ids
- 当前命名策略必须保持“兼容优先、投影优先”：
  - `Drive State` 是高层解释层
  - 不替换 `MissionStatus`
  - 不替换 workflow / orchestration status
  - 不替换 execution / recovery / timeline 的既有命名
  - 不代表旧命名依赖盘点已经完成

## 文档收口补充（2026-04-26）

为保证本 spec 可以在保守标准下继续收口，同时不把“文档定义完成”误写成“代码实现完成”，本轮补充以下文档交付口径：

- 底层状态清单
  - 文档中应给出一份“最小直接证据清单”，明确哪些状态来源已经能从 mission runtime / workflow runtime / execution / recovery / evidence / HITL 中直接锚定，哪些领域目前仍只到部分覆盖或间接投影。
- 主链路迁移图
  - 文档中应明确给出 `understanding -> planning -> fleet-forming -> executing -> reviewing -> delivered` 的标准推进路径，并逐段说明进入条件、退出条件与当前代码锚点。
  - 该图可以先作为设计/术语统一成果存在，不等同于当前仓库已经具备完整 transition event contract。
- `replanning` 真实触发信号
  - 文档中应把“当前已有直接锚点的真实信号”和“仍停留在目标态设计的触发器”拆开列出，避免把 review fail、dependency unavailable、constraint changed、human reroute 等设计语义误写成现状。
- 状态时间线最小事件字段
  - 文档中应给出一份最小 transition-level 事件字段建议，用于 replay / audit / cockpit 重建高层状态切换。
  - 同时应明确当前已有的 `evidence.timeline` / `evidence.correlation` / `explanation.currentState` / `explanation.remainingSteps` 只是最小骨架，不等于统一高层事件契约。
- 旧命名兼容风险说明
  - 文档中应明确列出当前仍需保留的旧命名族群，例如 `MissionStatus`、workflow runtime status、execution step status、recovery state、timeline event type、route selection status，并说明为什么当前不宜直接重命名。

本节的目标是约束文档必须把“目标态设计”和“当前最小实现事实”分层写清，而不是要求本轮额外修改代码。

## 验收标准

- 存在一份明确的中文设计文档，说明十个高层状态与其迁移关系
- 文档中明确解释 `replanning` 与 `retry`、`clarifying` 的区别
- 文档中明确说明与 Mission Runtime、workflow state、replay、audit 的兼容方式
- 文档中包含最小底层状态清单、标准主链路迁移图、`replanning` 真实信号分层、最小状态时间线事件字段、旧命名兼容风险说明
- 文档中未要求当前主仓立即大规模改名
- 存在一份与当前实现闭环一致、允许部分条目已完成的任务清单，用于后续渐进实现
