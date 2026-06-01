# 设计文档：Mission 模型到任务自动驾驶模型映射

## 设计概述

本设计的核心目标，不是创造一套替代当前主仓领域模型的新底层，而是增加一层“产品语义投影层”：

- 工程层继续使用 `Mission / Workflow / Runtime State / Decision-HITL`
- 产品层新增 `Destination / Route / Drive State / Takeover`

这两层不是互斥关系，而是“事实对象”和“用户态对象”的关系。

因此，本设计采用如下原则：

1. 兼容优先
2. 投影优先
3. 展示先行
4. 逐步收敛

其中最重要的一条是：

> 不建议立刻大规模修改底层命名。
> 先建立清晰映射，再根据真实使用效果决定是否需要更深层的领域重构。

## 设计目标

- 让 WhyBuddy 可以对外表达为“任务自动驾驶平台”
- 让现有任务系统、工作流系统、运行时状态、人工介入机制获得统一的上层产品解释
- 让后续驾驶舱界面有稳定的概念基础
- 降低大规模重命名和推翻式重构的风险

## 总体分层

### 第一层：工程事实层

这一层是当前主仓的真实执行基础，包括但不限于：

- `Mission`
- `Workflow`
- `Workflow Instance / Runtime State`
- `Decision`
- `HITL`
- `Audit / Replay / Lineage / Evidence`

这层的特点是：

- 贴近代码和运行时
- 已被现有 API、测试、任务系统、Web-AIGC 适配
- 稳定性优先于命名美感

### 第二层：产品语义层

这一层是面向用户、产品、信息架构的概念投影，包括：

- `Destination`
- `Route`
- `Drive State`
- `Takeover`

这层的特点是：

- 贴近用户理解
- 适合做驾驶舱展示
- 可以吸纳多种底层状态和对象

### 第三层：视图与交互层

这一层是前端消费产品语义的结构，例如：

- 目的地卡片
- 路线推荐面板
- 车队摘要
- 当前驾驶状态面板
- 接管点面板
- 回放与证据面板

## 核心映射设计

### 1. Mission -> Destination

#### 设计意图

`Mission` 是当前系统的任务事实对象，负责承载执行上下文、任务目标、会话关联、状态推进与交付结果。
在自动驾驶叙事下，用户更容易理解的是“我要去哪里”，因此需要将 `Mission` 投影成 `Destination`。

#### 映射关系

`Mission` 不直接改名为 `Destination`，而是通过投影生成一个面向用户的目的地对象。

建议映射如下：

| 工程事实字段 | 目标投影字段 | 说明 |
| ---- | ---- | ---- |
| mission.title | destination.goal | 用户想达成的结果概述；当前实现不让 summary/sourceText 反向覆盖明确标题 |
| mission.input | destination.request | 原始任务请求 |
| mission.summary / context | destination.context / confidence | 当前已知背景；summary 只能辅助 request、success、confidence 等语义，不作为 goal 覆盖来源 |
| mission.constraints | destination.constraints | 时间、预算、权限、风格等限制 |
| mission.successCriteria | destination.successCriteria | 成功定义 |
| mission.metadata.deliverables | destination.deliverables | 预期交付物 |
| mission.missingInfo | destination.missingInfo | 当前缺失信息 |

#### 设计结论

- `Mission` 继续作为运行时真实主对象
- `Destination` 作为产品展示与规划输入对象
- 两者允许阶段性不完全对齐

这意味着系统可以先以投影形式提供 `Destination`，而不是要求 `Mission` 一步重构成全新的领域对象。

#### 当前主仓最小字段映射表（2026-04-25）

当前主仓里，`Destination` 的最小字段并不是从一份独立 `DestinationRecord` 读取，而是由 `buildMissionAutopilotSummary(...)` 基于 `MissionRecord` 现有字段和运行时事实即时投影出来。

可直接锚定到当前实现的最小字段映射如下：

| 当前事实来源 | 当前投影字段 | 当前实现口径 |
| ---- | ---- | ---- |
| `mission.id` | `destination.id` | 直接沿用 Mission 主键 |
| `mission.title` | `destination.goal` | 为空时回退为 `Untitled mission` |
| `mission.sourceText` | `destination.request` | 优先作为原始任务请求；缺失时回退到 `summary / title` |
| `mission.kind` | `destination.constraints[]` | 当前以 `Mission kind: ...` 字符串形式进入约束 |
| `mission.projection?.sourceApp` | `destination.constraints[]` | 当前以 `Source app: ...` 字符串形式进入约束 |
| `mission.securitySummary?.level` | `destination.constraints[]` | 当前以 `Security level: ...` 字符串形式进入约束 |
| `mission.artifacts[].name`、`mission.workPackages[].deliverable` | `destination.deliverables[]` | 聚合后形成预期/中间交付物口径 |
| `mission.status === "waiting" && mission.waitingFor` | `destination.missingInfo[]` | 当前等待用户输入时直接进入缺失信息 |
| `mission.operatorState === "blocked" && mission.blocker?.reason` | `destination.missingInfo[]` | 当前阻塞原因也进入缺失信息 |
| `mission.waitingFor / mission.blocker / mission.decision?.type` | `destination.missingInfoDetails[]` | 当前可补充 impact 与 blocking 标记 |
| `mission.summary / sourceText / events / artifacts / waitingFor / blocker / decision?.prompt` | `destination.confidence` | 当前 confidence 是基于多信号推断，而不是单字段透传 |
| `mission.status / mission.artifacts` | `destination.successCriteria[]` | 当前按“Mission completes its current route / Artifacts are produced / Mission reaches delivered state”三类口径生成 |

#### Destination fallback 边界审计（2026-04-27）

本轮对 `Mission -> Destination` fallback 做了收口审计：当前 shared builder 的 `destination.goal` 只读取 `mission.title`，缺失时才使用 `Untitled mission` 默认值；`mission.sourceText` 与 `mission.summary` 只进入 `destination.request`、`normalizedGoal.summary`、success / confidence 等辅助语义，不应反向覆盖一个已经明确存在的 goal。

因此，后续实现如果新增显式 `destination` / `goal` 字段，优先级应保持为：

1. 显式 destination goal / locked goal（未来字段）
2. `mission.title`
3. 默认占位文案

`sourceText`、`summary`、decision prompt、option description 与 event message 可以作为 request/context/evidence/confidence 的输入，但不能作为覆盖明确 goal 的宽 fallback。`shared/__tests__/mission-autopilot.test.ts` 已补充回归用例，覆盖 sourceText / summary 比 title 更宽时，`destination.goal`、parsed destination title 与 workflow planner goal 仍保持 title。

这里需要明确两层边界：

- 上表描述的是“当前最小事实链”，已经有 shared builder、server projection 和相关测试支撑
- 上表还不是完整的 `Mission -> Destination` 总表；例如 `organization / messageLog / autonomy / instance / topicId` 等字段当前并未稳定进入 `Destination`

#### Mission 核心字段、状态与上下文来源映射总表（首版，2026-04-26）

为了让这份 spec 能真正承担“Mission -> Destination 映射说明书”的角色，本轮把当前主仓里能够直接追溯到 `buildMissionAutopilotSummary(...)` 的核心字段、状态与上下文来源，整理成首版总表。

| Mission 事实来源 | 当前是否直接进入 Destination | 当前投影位置 | 当前说明 |
| ---- | ---- | ---- | ---- |
| `mission.id` | 是 | `destination.id` | 作为 Destination 主标识 |
| `mission.title` | 是 | `destination.goal` | 主要目标摘要；缺失时回退默认标题 |
| `mission.sourceText` | 是 | `destination.request` | 优先作为原始任务请求 |
| `mission.summary` | 是 | `destination.request`、`destination.successCriteria[]`、`destination.confidence.reason` | 在 sourceText 缺失或 success signal 生成时参与投影 |
| `mission.kind` | 是 | `destination.constraints[]` | 当前以 `Mission kind: ...` 形式进入约束 |
| `mission.projection?.sourceApp` | 是 | `destination.constraints[]` | 当前以 `Source app: ...` 形式进入约束 |
| `mission.securitySummary?.level` | 是 | `destination.constraints[]` | 当前以 `Security level: ...` 形式进入约束 |
| `mission.artifacts[]` | 是 | `destination.deliverables[]`、`destination.successCriteria[]`、`destination.confidence.signals[]` | 工件名称进入 deliverables，存在工件时提升 success / confidence |
| `mission.workPackages[]` | 部分 | `destination.deliverables[]` | 当前仅 `deliverable` 被吸收；其他字段未稳定进入 |
| `mission.status` | 是 | `destination.successCriteria[]`、`destination.missingInfo[]` | `done / waiting` 等状态会影响 success / missing info 语义 |
| `mission.waitingFor` | 是 | `destination.missingInfo[]`、`destination.missingInfoDetails[]`、`destination.confidence.reason` | 当前最直接的缺失信息来源 |
| `mission.operatorState` | 是 | `destination.missingInfo[]`、`destination.missingInfoDetails[]` | `blocked` 会将 blocker 原因包装进缺失信息 |
| `mission.blocker?.reason` | 是 | `destination.missingInfo[]`、`destination.missingInfoDetails[]`、`destination.confidence.reason` | 当前阻塞上下文会被包装成缺口与低置信原因 |
| `mission.decision?.prompt / type` | 是 | `destination.missingInfoDetails[]`、`destination.confidence.signals[]` | 影响当前缺失信息 impact 与 confidence 信号 |
| `mission.events[]` | 是 | `destination.confidence.signals[]` | 当前只参与 confidence 推断，不直接展开到 destination 文本 |
| `mission.currentStageKey` | 否 | 不直接进入 Destination | 当前更多进入 `route / driveState / explanation` |
| `mission.stages[]` | 否 | 不直接进入 Destination | 当前属于 Route 骨架，而非 Destination |
| `mission.projection?.workflowId / replayId / sessionId` | 否 | 不直接进入 Destination | 当前更多进入 bindings / route / evidence correlation |
| `mission.executor / instance` | 否 | 不直接进入 Destination | 当前属于 execution / bindings / monitoring 侧事实 |
| `mission.organization / agentCrew` | 否 | 不直接进入 Destination | 当前未稳定吸收到 Destination |
| `mission.messageLog / autonomy / topicId` | 否 | 不直接进入 Destination | 当前尚未进入正式 Destination 映射表 |

这张首版总表的收口意义是：

- 已经覆盖“核心字段、状态与上下文来源”这一任务原文要求里的主体部分
- 也明确写出哪些字段当前没有进入 `Destination`
- 但它仍是“当前 builder 可追溯总表”，不是“MissionRecord 全字段映射完结版”

### 2. Workflow -> Route

#### 设计意图

`Workflow` 当前承担底层编排与执行定义职责，但对于用户而言，“工作流”属于工程术语。
自动驾驶叙事需要一个更贴近用户的概念，也就是“路线”。

#### 映射关系

`Route` 不等于单个 `Workflow` 文件或 DAG 定义，而是从多个工程对象中归纳出的高层执行路径。

建议映射如下：

| 工程事实对象 | 目标投影字段 | 说明 |
| ---- | ---- | ---- |
| workflow.definition | route.structure | 路线骨架 |
| workflow.phases / stages | route.stages | 用户可理解的阶段划分 |
| workflow.edges / branching | route.transitions | 路线切换与分支逻辑 |
| workflow.parallel groups | route.parallelism | 并行执行安排 |
| governance checkpoints | route.riskPoints | 风险点 |
| hitl / decision nodes | route.takeoverPoints | 接管点 |

#### 关键说明

- `Route` 可以投影自一个 workflow，也可以聚合多个 workflow 片段
- `Route` 允许存在“推荐路线”和“替代路线”
- `Route` 的职责是“解释系统准备怎么送达结果”，不是替代底层执行图

#### 设计结论

- `Workflow` 保持底层编排职责
- `Route` 提供产品层解释、推荐和展示
- 不建议为追求名词统一，直接废弃 `Workflow`

#### 当前主仓最小映射表（2026-04-25）

当前主仓里，`Route` 也不是对 `Workflow` 结构体的逐字段镜像，而是由 `MissionRecord`、`projection links`、`decision / decisionHistory`、`operatorActions` 与运行时上下文共同归纳出的高层执行路径摘要。

可直接锚定到当前实现的最小映射如下：

| 当前事实来源 | 当前投影字段 | 当前实现口径 |
| ---- | ---- | ---- |
| `input.workflowId || mission.projection?.workflowId || mission.id` | `route.id` | 当前 route 主键优先复用 workflowId，没有时回退 missionId |
| `mission.currentStageKey / mission.stages[*].label` | `route.currentStageKey / route.currentStageLabel` | 当前阶段直接来自 Mission stage 蓝图 |
| `mission.stages[]` | `route.stages[]` | 当前阶段数组是最稳定的路线骨架来源 |
| `mission.status` | `route.status / route.locked` | 当前 route status 由 synthetic workflow status 推断，waiting/done/failed/cancelled 会锁定路线 |
| `mission.summary / waitingFor / risk / takeoverType` | `route.mode / route.candidateRoutes[]` | 当前 `fast / standard / deep` 候选路线由 Mission 风险与阶段推断出来 |
| `mission.decision?.decisionId`、等待状态 | `route.takeoverPointIds[]` | 决策点或等待点直接成为路线接管点 |
| `mission.decisionHistory`、`decision.payload`、`resolved.metadata.formData` | `route.selection / selectedRouteId / recommendedRouteId / selectionStatus` | 当前用户选路、payload fallback 与历史选择对齐均已在 builder 中收口 |
| `mission.blocker / mission.waitingFor / operatorState / events.warn` | `route.riskPoints[]` | 当前风险点更多来自运行态与治理信号，而不是 workflow 静态定义 |
| `mission.operatorActions / attempt / blocker / waitingFor` | `route.replan` | 当前重规划对象更多是 recovery-driven route 解释 |
| `route selected/recommended state + event history` | `route.evidence` | 当前 evidence 负责解释推荐、选择、锁定、重规划等路线事实 |

因此，当前主仓里的 `Workflow -> Route` 更准确地说是：

- `Workflow / projection links` 提供 route identity 与一部分骨架锚点
- `Mission.stages / decision / decisionHistory / operatorActions / blocker` 提供 route 的动态解释层
- `Route` 当前已经是可稳定消费的展示对象，但仍不是完整 workflow definition 的全量镜像

#### Workflow / Runtime / Decision 联合映射表（收口版）

为了避免把 `Route` 错写成“只从 workflow 来”，当前更合理的统一表述是：

| 工程对象 | 在 Route 中承担的职责 | 当前可直接落地的字段 |
| ---- | ---- | ---- |
| `Workflow / MissionProjectionLinks` | 提供路线身份与外部关联锚点 | `route.id`、`bindings.workflowId`、evidence correlation 里的 `workflowId` |
| `Mission.stages / currentStageKey` | 提供阶段骨架与当前所在阶段 | `route.currentStageKey`、`route.currentStageLabel`、`route.stages[]` |
| `Decision / decisionHistory` | 提供接管点与路线选择解释 | `route.takeoverPointIds`、`candidateRoutes`、`selection`、`selectionStatus` |
| `Runtime / operator state / blocker / retries` | 提供锁定、风险、重规划与证据变化 | `route.locked`、`riskPoints`、`replan`、`route.evidence` |

这张表的收口含义是：

- 当前我们已经能解释“为什么 Route 不等于单个 workflow 文件”
- 但仍不能把它外推成 `Workflow definition / branching / parallel groups` 的完整结构审计已经完成

#### Workflow 定义结构、阶段语义、分支与并行能力映射表（首版，2026-04-26）

为了避免把 `Workflow -> Route` 永远停留在抽象口号层，这里把当前主仓已经存在的 workflow 结构术语，与当前 `Route`/`projection` 中实际可消费的字段整理成首版结构映射表。

| Workflow / Graph 事实 | 当前锚点 | 当前对应的 Route / Autopilot 语义 | 当前边界 |
| ---- | ---- | ---- | ---- |
| workflow identity | `workflow.id`、`MissionProjectionLinks.workflowId` | `route.id`、`bindings.workflowId`、`evidence.correlation.workflowId` | 已稳定进入 route identity |
| workflow status | `workflow.status` | `route.status`、`explanation.currentState.workflowStatus` | 当前通过 synthetic status 归并，不是原值直出 |
| workflow current stage | `workflow.current_stage` | `explanation.currentState.workflowStage`、projection graph `currentStage` | 当前更多作为 explanation / graph 事实，不直接替代 `mission.stages` |
| workflow directive | `workflow.directive` | graph / monitoring 侧的路线背景说明 | 当前未直接进入 `route.label` 或 `candidateRoutes` |
| mission stage blueprint | `mission.stages[]` | `route.stages[]`、`route.currentStageKey`、`route.currentStageLabel` | 当前是 Route 阶段骨架最稳定来源 |
| graph node runs | `GraphInstanceSnapshot.nodeRuns[]` | workflow graph 视角的执行节点与组织结构锚点 | 当前未直接折叠进 `route.stages[]` |
| graph edge transitions | `GraphInstanceSnapshot.edgeTransitions[]` | 分支、父子、控制流路径的底层证据 | 当前未直接展开成 route transition 列表 |
| conditional branch edges | runtime graph `edgeSchemas.kind = conditional`、resume 后 `edgeTransitions.status = executed` | `Route.selection`、`candidateRoutes`、`Takeover route-selection` 的底层结构证据 | 当前说明“分支能力存在”，但尚未形成正式 route transition 总表 |
| WAITING_INPUT checkpoints | runtime checkpoint `waitingFor`、decision metadata | `route.takeoverPointIds`、`takeover`、`destination.missingInfo*` | 当前是 route takeover point 的主要来源 |
| multi-choice route payload | `decision.payload.candidateRoutes / routeMap / selectedRouteId` | `route.candidateRoutes[]`、`selection`、`selectedRouteId`、`recommendedRouteId` | 已稳定成为 Route 候选路线来源 |
| branchKey after resume | `resolved.metadata.branchKey`、runtime variables | route selection / confirm_judge 之后的动态路线切换语义 | 当前有 runtime test 证据，但未统一沉淀为 route transition schema |
| parallel execution hints | `execution.parallelBranchCount`、graph organization/task counts | `execution.parallelBranchCount`、`remainingSteps.parallelBranchCount` | 当前只形成执行摘要，不是 Route 级并行总表 |
| operator retry / escalate / blocker | `mission.operatorActions`、`mission.attempt`、`mission.blocker` | `route.replan`、`route.evidence`、`route.selectionStatus = replanned` | 当前重规划是 recovery-driven route 解释 |

这张首版结构映射表的收口结论是：

- 当前仓库已经足以解释“Workflow 的定义结构、阶段语义、分支与并行能力如何进入 Route 叙事”
- 但当前 Route 仍是“workflow / mission / decision / runtime / graph facts 的联合投影”
- 因此，它支持完成“首版映射表”，但还不能宣称“完整 workflow 结构审计已经结束”

### 3. Runtime State -> Drive State

#### 设计意图

当前运行态通常分散在多个地方：

- mission 状态
- workflow instance 状态
- node run 状态
- replay / audit 事件
- review / verify / revise 中间态

这些状态对系统有意义，但对用户不够直观。
因此需要一个高层的 `Drive State` 来统一解释。

#### Drive State 建议集合

建议优先定义以下高层状态：

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

#### 映射规则

`Drive State` 不要求与任一底层状态一一对应，而是允许由多种信号共同推断。

示例：

| 底层信号 | Drive State | 说明 |
| ---- | ---- | ---- |
| mission created + context incomplete | understanding | 正在理解目的地 |
| workflow waiting for user input | clarifying / takeover-required | 需要补充信息 |
| route generated + not started | planning | 路线生成阶段 |
| multiple agents assigned | fleet-forming | 编队中 |
| workflow actively running | executing | 执行中 |
| review / audit / verify active | reviewing | 复核中 |
| runtime blocked / retry exhausted | blocked | 阻塞 |
| decision pending | takeover-required | 等待用户接管 |
| runtime switched path | replanning | 重规划 |
| final artifacts emitted | delivered | 已送达结果 |

#### 设计结论

- `Drive State` 是高层解释对象
- 可以由运行时投影器、前端 selector 或服务端 projection 生成
- 不要求底层 runtime state 立即重构

### 4. Decision / HITL -> Takeover

#### 设计意图

当前系统已经有人工确认、人工恢复、审批与决策链路，但这些能力在产品层分散且名称偏工程化。
自动驾驶叙事中，最自然的统一词汇是 `Takeover`。

#### 映射范围

以下能力都应被纳入 `Takeover`：

- 澄清提问
- 人工选择分支
- 审批确认
- 权限授权
- 预算确认
- 输出验收
- 异常人工接管

#### 映射模型

建议定义统一的接管对象投影：

| 工程事实对象 | takeover 字段 | 说明 |
| ---- | ---- | ---- |
| pending decision | takeover.reason | 为什么需要接管 |
| hitl checkpoint | takeover.type | 接管类型 |
| required input schema | takeover.input | 需要用户补充什么 |
| branch options | takeover.options | 可选方向 |
| permission / budget policy | takeover.constraints | 接管限制条件 |
| timeout / urgency | takeover.urgency | 紧急程度 |

#### 设计结论

- `Takeover` 是对多类 HITL 机制的统一包装
- 保留原有执行真实性
- 提升产品可理解性和信任感

## 兼容策略

### 策略 1：不做底层大规模即时改名

本设计明确不建议当前就执行以下动作：

- 将所有 `Mission` 类、接口、文件批量重命名为 `Destination`
- 将所有 `Workflow` 对象和 API 直接替换为 `Route`
- 将所有 runtime state 统一重写为 drive state
- 将 decision / approval / hitl 节点全部立刻改成 takeover 命名

原因如下：

- 当前系统已有大量 spec、测试、接口、运行时逻辑依赖既有命名
- 大规模改名会制造高噪音提交
- 改名本身并不等于真正完成产品建模
- 当前阶段最需要的是稳定映射，而不是词汇整齐

### 策略 2：优先做投影对象

建议优先新增以下“上层对象”：

- destination projection
- route projection
- drive-state projection
- takeover projection

这些对象可以：

- 存在于服务端 projection 层
- 存在于前端 view model 层
- 存在于 steering / spec / README 文档层

### 策略 3：逐步把现有页面升级为自动驾驶表达

优先升级的不是底层 runtime 文件名，而是：

- 任务详情页中的目标摘要
- workflow 可视化中的路线解释
- session / task 中的等待输入和确认状态
- replay / audit 中的驾驶状态与接管证据

### 策略 3.1：前端状态映射边界（2026-04-26）

前端不应把 `Mission / Workflow / Runtime / Decision` 再复制成一套长期平行模型。本轮前端落地的安全边界是三层状态：

| 前端状态层 | 生命周期 | 主要事实来源 | 允许写入 | 不应承担 |
| ---- | ---- | ---- | ---- | ---- |
| `destination draft` | 用户输入到提交前 | launch composer、附件摘要、目的地 preview | 本地草稿、缺失字段提示、附件影响摘要 | 不持久化为 locked destination，不替代 parser 审计字段 |
| `route planning` | 规划浮层打开到确认路线前 | `candidateRoutes`、`recommendedRouteId`、临时 `selectedRouteId` | 规划期选择、恢复推荐、确认执行意图 | 不直接改写 runtime route，不伪造 planner 输出 |
| `mission projection` | 任务创建后到完成/回放 | `autopilotSummary`、mission projection、decision history、runtime evidence | 只通过正式 decision / route mutation / task action 写回 | 不从组件局部状态反推权威 route / takeover / evidence |

`selectedRouteId` 的生命周期必须按阶段解释：

1. 在 `route planning` 中，它是“待确认选择”，可以被 overlay 切换或恢复为推荐路线。
2. 在确认执行后，它必须进入 route selection / mission projection 的权威摘要链，随后由 `autopilotSummary.route.selectedRouteId` 消费。
3. 执行期如果发生改线，组件只能消费 `selection.mode = runtime_replanned`、`route.replan.*` 和 evidence 事件；不能只靠本地 `selectedRouteId` 覆盖运行时事实。

这意味着 `useAutopilotRoutePlan`、`useAutopilotCockpitModel` 或等价 selector 的职责，是把 shared/server projection 投影成稳定 view model，而不是重新实现 planner、runtime 或 replay 逻辑。

### 策略 4：Web-AIGC 侧继续保留节点内部视角

当前 50+ Web-AIGC 节点不应直接暴露给用户作为主产品语言。
建议：

- 内部继续保留节点编排
- 外部逐步抽象为路线阶段与车队角色
- 后续再扩展“节点角色分类”和“车队编组”层

## Web-AIGC 节点兼容附录（首版）

本附录的目标不是把全部 Web-AIGC 节点逐个映射成 autopilot 对象，而是说明当前主仓里这些节点事实如何被保守吸收到 `Mission / Decision / Route / Takeover` 这条映射链里。

### 1. 当前已存在的直接锚点

- `shared/mission/contracts.ts` 已定义 `WEB_AIGC_HITL_NODE_TYPES`
  - `user_input`
  - `selection`
  - `param_collection`
  - `confirm_judge`
  - `intent_recognition`
  - `command_list`
  - `recommended_commands`
- 同一文件还定义了 `WebAigcHitlFieldDefinition`、`WebAigcHitlFormData`、`WebAigcHitlSubmissionMetadata`
- `MissionDecisionSubmission.metadata` 与 `DecisionHistoryEntry` 已允许保留 `nodeType / nodeId / interactionId / branchKey / sessionId / formData`
- 这意味着当前 Web-AIGC 节点并不是被 autopilot summary 直接读取，而是先被收进 `MissionDecision` 与 `DecisionHistory` 这条事实链，再由 `buildMissionAutopilotSummary(...)` 统一解释成 `Takeover / Route / Destination` 相关字段

### 2. 当前最小包装路径

当前可保守确认的最小包装路径如下：

| Web-AIGC 事实 | 当前进入的工程对象 | 当前被重新包装成的 autopilot 语义 |
| ---- | ---- | ---- |
| `user_input / param_collection / intent_recognition` | `MissionDecision`、`waitingFor`、`DecisionHistoryEntry.metadata` | `Takeover` 中的 `clarification` / `operator`，以及 `Destination.missingInfo*` |
| `selection / recommended_commands / command_list` | `MissionDecision.type === "multi-choice"`、`decision.payload.candidateRoutes`、`resolved.metadata.formData` | `Route.selection`、`candidateRoutes`、`route-selection takeover` |
| `confirm_judge` | `MissionDecision` / `approval` / `decisionHistory` | `Takeover` 中的 `approval / delivery-review / permission / budget` |
| 节点执行来源 `sourceApp: web-aigc` | `MissionProjectionLinks.sourceApp` | `Destination.constraints[]` 中的 `Source app: web-aigc`，以及跨链路来源说明 |

### 2.1 节点家族 -> 路线阶段 / 车队角色的首版包装矩阵

在保守口径下，本 spec 不做“50+ 节点逐节点目录”，但可以收口一版“节点家族级”包装矩阵，说明当前哪些节点事实应优先被翻译成 `Route stage` 与 `Fleet role`。

| 节点家族 | 当前主仓锚点 | 优先包装到的 Route 阶段 | 优先包装到的 Fleet 角色 | 当前包装路径 |
| ---- | ---- | ---- | ---- | ---- |
| 目标理解 / 路线建议 | `intent_recognition`、route recommendation、`recommendationDetails(kind=route)` | `understanding / planning` | `Planner` | 先进入 Mission/Route recommendation，再由 autopilot summary 表达为路线草案与推荐理由 |
| 用户输入 / 参数收集 | `user_input`、`param_collection`、`waitingFor`、`formData` | `clarifying / takeover-required` | `Clarifier` | 先进入 `MissionDecision`、`waitingFor`、`missingInfoDetails`，再表达为澄清型接管与缺失信息 |
| 选择 / 确认 | `selection`、`recommended_commands`、`command_list`、`confirm_judge` | `planning / takeover-required / reviewing` | `Clarifier`、`Reviewer` | 先进入 `decision.payload / decisionHistory / resolved.metadata`，再表达为 `route.selection`、`takeover`、结果确认 |
| 搜索 / 检索 / 问答 | search、document_search、RAG、QA 路由与节点族 | `executing: research-heavy` | `Researcher` | 先作为检索/问答事实进入 route execution 与 evidence，再在产品层表达为研究型执行阶段 |
| 生成 / 文件输出 | 内容生成、文档/图表/文件输出节点 | `executing: generation-heavy` | `Generator` | 先作为产出与 artifact 进入 Mission/summary，再包装为生成型阶段与交付产物 |
| 外部动作 / 页面控制 | open page、dashboard action、browser/native command | `executing: operator-heavy` | `Operator` | 先通过 executor / runtime action / permission chain 落地，再包装为外部动作阶段 |
| 审核 / 判断 / 比对 | judge、compare、verification、confirm_judge | `reviewing / delivery` | `Reviewer` | 先进入 decision / review / acceptance 事实，再包装为验收与纠偏阶段 |
| 审计 / 治理 / 证据 | audit、lineage、policy、evidence、risk governance | `reviewing / governance gate` | `Auditor` | 先进入 audit / replay / evidence correlation，再包装为治理护栏与证据收口 |
| 编排 / 分支同步 | orchestration、branchKey、conditional edge、stage sync | `planning / replanning / branch convergence` | `Coordinator` | 先进入 workflow graph / branch / route replan 事实，再包装为分支切换与编排收敛语义 |

这张矩阵的使用方式必须继续收紧：

- 它是“节点家族级首版附录”，不是逐节点产品目录。
- `Route stage` 这里表达的是产品层的阶段语义，不等于 runtime graph 的原生 stage key。
- `Fleet role` 这里表达的是对用户可见的职责包装，不等于 shared builder 当前已经稳定产出这些角色。
- 其中真正已有最小直接 shared/server 产出支撑的，仍主要是：
  - `Takeover` 对澄清、审批、路线选择的统一包装
  - `Route.selection / candidateRoutes / replan` 对选择与分支切换的统一包装
  - `Destination.missingInfo*` 对信息缺口的统一包装
  - README / fleet spec 对 `Planner / Clarifier / Researcher / Generator / Operator / Reviewer / Auditor / Coordinator` 词汇的统一包装

### 2.2 为什么这版附录现在可以收口

当前仓内已经存在三层可以直接拼起来的设计与术语锚点：

1. mapping 主链锚点
   - `MissionDecisionSubmission.metadata`
   - `MissionDecisionResolved.metadata`
   - `DecisionHistoryEntry.nodeType / nodeId / interactionId / branchKey`
   - `sourceApp: web-aigc`
   - runtime tests 中的 `selection / confirm_judge / param_collection`
2. fleet 角色锚点
   - `.kiro/specs/fleet-organization-and-role-packaging/design.md` 已给出节点家族到角色家族的初步分类表
   - 同文件已给出 `understanding / planning / executing / reviewing / takeover-required / replanning` 对应的角色启停矩阵
3. README / 产品术语锚点
   - README 已明确 `Fleet` 是由 Agent、技能、Web-AIGC 节点、工具、执行器和治理模块共同承接的角色编队

因此，本 spec 现在可以把“兼容吸收附录”进一步收口为：

- 节点家族事实先被吸收到 `Mission / Decision / Route / Takeover`
- 再按产品语义包装到 `Route stage` 与 `Fleet role`
- 但仍不宣称 shared / server 已经形成逐节点、逐运行态的稳定投影合同

### 3. 当前可以说到哪一步

当前可以保守确认的是：

- Web-AIGC 节点体系已经具备进入 autopilot mapping 的入口
- 当前最直接的入口是 HITL / Decision / sourceApp / formData / decisionHistory，而不是节点执行图本身
- 这足以支撑“节点不直接暴露给用户，而是被重新包装成接管点、路线选择点、缺失信息与来源约束”的产品叙事

当前不能外推的是：

- 50+ 节点都已有逐节点 `Route stage` 分类
- 节点已经稳定映射到 `Fleet role` 家族
- 节点级 runtime 状态已经完整投影到 autopilot product objects

### 4. 面向 Web-AIGC 节点体系的当前附录边界（2026-04-26）

为了避免误把“兼容吸收附录”写成“节点产品化映射已完成”，这里再明确一层边界：

| 当前证据 | 可以安全声明的结论 | 仍不能外推的结论 |
| ---- | ---- | ---- |
| `WEB_AIGC_HITL_NODE_TYPES`、`WebAigcHitlFieldDefinition`、`WebAigcHitlFormData` | Web-AIGC 已有成体系的人机交互节点类型与表单语义 | 节点已经完成产品层分类目录 |
| `MissionDecisionSubmission.metadata`、`MissionDecisionResolved.metadata`、`DecisionHistoryEntry` | 节点的 `nodeType / nodeId / interactionId / branchKey / formData` 能进入 Mission/Decision 事实链 | 节点执行图已经直接变成 autopilot object |
| runtime tests 中的 `selection / confirm_judge / param_collection` | Web-AIGC 节点已可通过等待、恢复、branchKey、formData 影响 route selection / takeover / missing info | 所有节点都已经映射到 route stage / fleet role |
| `sourceApp: web-aigc` 与 projection links | 可以把 Web-AIGC 作为 route/destination 的来源约束与跨链路解释 | 来源约束已经等于节点级路线建模 |

因此，这份附录当前的完成语义应当是：

- 已经形成“节点体系如何被 Mission / Decision / Route / Takeover 吸收”的首版附录
- 已经形成“节点家族 -> 路线阶段 / 车队角色”的首版包装矩阵
- 仍未形成“50+ 节点逐节点 -> 路线阶段 / 车队角色”的正式目录
- 后续若要继续推进，应拆到更专门的 fleet / route-stage / runtime-node-family specs 中处理

因此，本附录的完成含义是：

- 已经说明 Web-AIGC 如何被当前 mapping 层兼容吸收
- 已经完成逐“节点家族”级别的首版包装附录
- 还没有完成逐节点、逐运行态的完整 mapping 目录

## 推荐的落地结构

### 服务端

建议增加投影层能力，而不是替换底层对象：

- `mission -> destination projection`
- `workflow -> route projection`
- `runtime -> drive-state projection`
- `decision/hitl -> takeover projection`

### 前端

建议让主界面围绕四个对象消费数据：

- `destination`
- `route`
- `driveState`
- `takeover`

### 文档与规格

后续 specs、README、架构图、产品说明可以统一升级到自动驾驶叙事，但应在文档中保留与旧模型的映射说明。

## 风险与边界

### 风险 1：只改词，不改对象

如果只是把文案从 `Mission` 改成 `Destination`，但没有实际投影结构，最终会导致：

- 文档很好看
- 界面很难落地
- 工程侧无法稳定消费

### 风险 2：过早重命名底层

如果在映射未稳定前就大规模改名，容易造成：

- 现有 spec 与代码脱节
- 测试批量失效
- 开发心智混乱

### 风险 3：把自动驾驶对象做成全新孤岛

如果新对象完全脱离当前主仓对象体系，会导致：

- 双模型长期并存却无法互通
- 前后端概念不一致
- 无法复用现有 Mission Runtime 能力

## 设计结论

本 spec 的最终设计结论是：

1. 自动驾驶模型应作为产品语义层引入
2. 当前工程层模型继续保留
3. 四组核心映射是当前阶段的首要工作：
   - `Mission -> Destination`
   - `Workflow -> Route`
   - `Runtime State -> Drive State`
   - `Decision / HITL -> Takeover`
4. 兼容优先，不建议立即大规模底层改名
5. 后续应通过 projection、view model、驾驶舱 IA 与治理视图逐步落地

## 当前主仓审计备注（2026-04-25）

以下内容用于说明当前主仓中哪些 mapping 已经有 shared / server 投影与测试支撑，哪些仍停留在设计层。

### 已有最小闭环

1. `Mission -> Destination` 已形成最小展示级投影闭环，但仍停留在展示字段层。

- `shared/mission/autopilot.ts` 已直接产出 `destination.goal / request / constraints / successCriteria / deliverables / missingInfo / confidence / missingInfoDetails`。
- `shared/__tests__/mission-autopilot.test.ts` 已验证运行中、等待接管、阻塞重试、低证据任务等场景下的 `Destination` 字段。
- `server/tasks/mission-projection.ts` 会将 shared builder 产出的 `destination` 随 `autopilotSummary` 透传到任务 projection 接口，`server/tests/mission-routes.test.ts` 已验证 request / constraints / successCriteria / deliverables / missingInfo 等字段。
- `client/src/lib/tasks-store.ts` 与 `client/src/components/tasks/TaskAutopilotPanel.tsx` 会继续消费该对象，`client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 已验证 destination confidence、missing-info impact、structured missingInfoDetails 等展示。
- 但当前证据仍不足以证明 Mission 核心字段、状态、上下文来源已经被完整梳理成“总映射表”，因此只能保守确认“最小展示结构已落地”，不能确认“完整字段审计已完成”。

2. `Workflow -> Route` 已形成最小展示级投影闭环，但仍未完成 workflow 结构总表。

- `shared/mission/autopilot.ts` 已直接产出 `route.label / mode / status / stages / riskPoints / takeoverPointIds / candidateRoutes / selection / evidence / replan`。
- `shared/__tests__/mission-autopilot.test.ts` 已覆盖推荐路线、候选路线、等待决策导致的路线锁定、阻塞后的 replanned 状态、route evidence 与 replan 摘要。
- `server/tasks/mission-projection.ts` 负责把该对象透传到 projection 接口，`server/tests/mission-routes.test.ts` 已验证 `route.candidateRoutes / selection / evidence / replan / takeoverPointIds` 与 workflow link 对齐。
- `client/src/lib/tasks-store.ts` 与 `client/src/components/tasks/TaskAutopilotPanel.tsx` 会继续兼容消费 `route`，`client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 已验证 route diff、route selection、route evidence、剩余步骤、ETA / cost 汇总等展示。
- 但当前仍缺少对 workflow definition、branching、parallel groups 的系统化梳理，因此不能保守外推为“Workflow -> Route 映射表已经完整完成”。

3. `Runtime State -> Drive State` 已形成共享归并规则。

- `shared/mission/autopilot.ts` 已稳定输出十态 `Drive State` 集合，包括 `understanding / planning / executing / reviewing / blocked / takeover-required / replanning / delivered`。
- 相关规则已覆盖等待、失败、重试重规划等场景，且 shared builder 与 server `mission-routes` 投影测试均已验证。

4. `Decision / HITL -> Takeover` 已形成共享投影对象。

- `shared/mission/autopilot.ts` 已输出统一 `takeover` 摘要：`status / required / blocking / type / reason / prompt / decisionId / options / urgency`。
- 当前类型集合已覆盖 `clarification / approval / permission / budget / risk-acceptance / route-selection / delivery-review / exception / operator`。
- `server/tasks/mission-projection.ts` 会把这组字段稳定透传到任务投影接口，等待决策场景已有服务端测试覆盖。

5. 兼容优先、投影优先与最小落地顺序已具备文档与实现锚点。

- 本文“兼容策略”和“推荐的落地结构”已经明确：先做 `destination / route / drive-state / takeover` projection，而不是大规模重命名底层 `mission / workflow / runtime / decision`。
- 当前主仓实现也符合这一顺序：shared builder 先产出 `autopilotSummary`，server projection 再透传，前端作为消费层兼容。

6. 与后续 specs 的边界已经可以落到当前依赖关系上。

- `Destination / Route` 的最小展示结构已由本 spec 承接。
- `Drive State` 细化由 `drive-state-and-replan-state-machine` 继续展开。
- `Takeover` 的交互与优先级由 `takeover-panel-and-decision-points` 继续展开。
- 更细的 runtime 编排与治理解释由 `autopilot-runtime-orchestration`、`autopilot-recovery-and-human-takeover-governance` 继续展开。

7. 旧命名强依赖已经可以保守落成一份风险清单。

- `shared/mission/api.ts` 中 API 路由、响应类型和 projection 类型仍以 `Mission` 命名为主，例如 `MISSION_API_ROUTES`、`MissionProjectionView`、`GetMissionProjectionResponse`。
- `shared/mission/index.ts` 继续从 `./autopilot.js`、`./api.js` 向外暴露基于 `Mission` 命名空间的 contracts，说明对外 barrel 仍以旧命名承载新投影。
- `server/tasks/mission-projection.ts` 的入口、构造函数与返回对象仍围绕 `buildMissionProjectionView`、`buildMissionSessionView`、`MissionProjectionView` 组织，只是在内部附带 `autopilotSummary`。
- `server/tests/mission-routes.test.ts` 断言的接口路径仍是 `/api/tasks/:id/projection` 与 `/api/tasks/:id/session`，并以 `projection.autopilotSummary` 的方式消费新模型。
- `client/src/lib/tasks-store.ts` 仍以 `MissionTaskSummary / MissionTaskDetail / buildMissionAutopilotSummary` 为核心聚合前端 view model，只把新投影兼容进 `autopilotSummary` 字段。
- `client/src/components/tasks/TaskAutopilotPanel.tsx` 与其测试证明 UI 已能消费 `destination / route / driveState / takeover / evidence / explanation`，但面板仍是挂载在 `TaskDetailView` 中的 `autopilotSummary` 分区，而非整体重命名后的页面对象。
- 因此，可以保守确认：主仓已经存在对旧命名的 API、shared contract、server projection、client store、UI 容器级强依赖；这支持“不要立即大规模改名”的迁移判断。

### 仍未完成的部分

- 仍未产出完整的 Mission 字段总表、Workflow 结构总表，以及覆盖全部调用点的旧命名强依赖完整清单；当前只能保守确认已形成首版风险清单。
- 仍未形成面向 README / 架构图的正式统一术语附录文件，只是在本 spec、README 与相关 steering 中已经出现一致口径。
- 因此，本轮可保守确认的是“最小 mapping 投影与边界说明已经落地”，而不是“完整映射附录与迁移包已经完成”。

### Lane 收口补充（2026-04-25）

- 本轮补上的重点，是把此前仍停留在口头描述中的三类内容写成成体系的 spec 文档：
  - 当前主仓可直接锚定的 `Mission -> Destination` 最小字段映射表
  - 当前主仓可直接锚定的 `Workflow / Runtime / Decision -> Route` 最小映射表
  - 面向 Web-AIGC 节点体系的首版兼容附录
  - 节点家族到 `Route stage / Fleet role` 的首版包装矩阵
- 这几块新增内容的共同原则是：
  - 只写当前实现和测试已经能直接指到的最小事实链
  - 不把尚未完成的完整总表、完整 workflow 结构审计、完整节点分类目录误写成已实现
- 因此，这轮 design 的推进含义是“mapping spec 的文档收口更完整了”，而不是“底层领域迁移已经完成”。
